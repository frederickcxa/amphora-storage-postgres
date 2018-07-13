'use strict';

const { POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB } = require('../services/constants'),
  { notFoundError } = require('../services/errors'),
  { parseOrNot, wrapInObject } = require('../services/utils'),
  { findSchemaAndTable, wrapJSONStringInObject } = require('../services/utils'),
  knexLib = require('knex'),
  TransformStream = require('../services/list-transform-stream'),
  META_PUT_PATCH_FN = patch('meta');
var knex;

/**
 * Connect to the default DB and create the Clay
 * DB. Once the DB has been made the connection
 * can be killed and we can try to re-connect
 * to the Clay DB
 *
 * @returns {Promise}
 */
function createDBIfNotExists() {
  const tmpClient = knexLib({
    client: 'pg',
    connection: {
      host: POSTGRES_HOST,
      user: POSTGRES_USER,
      password: POSTGRES_PASSWORD,
      database: 'postgres',
      port: POSTGRES_PORT
    }
  });

  // https://github.com/clay/amphora-storage-postgres/pull/7/files/16d3429767943a593ad9667b0d471fefc15088d3#diff-6a1e11a6146d3a5a01f955a44a2ac07a
  return tmpClient.raw(`CREATE DATABASE ${POSTGRES_DB}`)
    .then(() => tmpClient.destroy())
    .then(connect);
}

/**
 * Connect to the DB. We need to do a quick check
 * to see if we're actually connected to the Clay
 * DB. If we aren't, connect to default and then
 * use that connection to create the Clay DB.
 *
 * @returns {Promise}
 */
function connect() {
  knex = knexLib({
    client: 'pg',
    connection: {
      host: POSTGRES_HOST,
      user: POSTGRES_USER,
      password: POSTGRES_PASSWORD,
      database: POSTGRES_DB,
      port: POSTGRES_PORT
    }
  });

  // TODO: improve error catch! https://github.com/clay/amphora-storage-postgres/pull/7/files/16d3429767943a593ad9667b0d471fefc15088d3#diff-6a1e11a6146d3a5a01f955a44a2ac07a
  return knex.table('information_schema.tables').first()
    .catch(createDBIfNotExists);
}

function pullValFromRows(key, prop) {
  return (resp) => {
    if (!resp.length) return notFoundError(key);

    return resp[0][prop];
  };
}

function baseQuery(key) {
  const { schema, table } = findSchemaAndTable(key);

  return schema
    ? knex(table).withSchema(schema)
    : knex(table);
}

/**
 * Retrieve a single entry from the DB
 *
 * @param  {String} key
 * @return {Promise}
 */
function get(key) {
  return baseQuery(key)
    .select('data')
    .where('id', key)
    .then(pullValFromRows(key, 'data'));
}

/**
 * Insert a row into the DB
 *
 * @param  {String} key
 * @param  {Object} value
 * @return {Promise}
 */
function put(key, value) {
  const { schema, table } = findSchemaAndTable(key);

  return onConflictPut(key, wrapInObject(key,parseOrNot(value)), 'data', schema, table);
}

/**
 *
 * @param {*} key
 * @param {*} value
 */
function patch(prop) {
  return (key, value) => {
    const { schema, table } = findSchemaAndTable(key);

    return knex.raw('UPDATE ?? SET ?? = ?? || ? WHERE id = ?', [`${schema ? `${schema}.` : ''}${table}`, prop, prop, JSON.stringify(value), key]);
  };
}

/**
 * Given a key (id), data, which column that
 * data lives at, a schema and a table a `NO
 * CONFLICT` insert is executed
 *
 * TODO: BETTER COMMENT https://github.com/clay/amphora-storage-postgres/pull/7/files/16d3429767943a593ad9667b0d471fefc15088d3#diff-6a1e11a6146d3a5a01f955a44a2ac07a
 *
 * @param {String} id
 * @param {Object|String} data
 * @param {String} dataProp
 * @param {String} schema
 * @param {String} table
 * @returns {Promise}
 */
function onConflictPut(id, data, dataProp, schema, table) {
  var insert, update, putObj = { id };

  putObj[dataProp] = data;

  if (schema) {
    insert = knex.withSchema(schema).table(table).insert(putObj);
  } else {
    insert = knex.table(table).insert(putObj);
  }

  update = knex.queryBuilder().update(putObj);

  return knex.raw('? ON CONFLICT (id) DO ? returning *', [insert, update])
    .then(() => data);
}

/**
 * Insert a row into the DB
 *
 * @param  {String} key
 * @param  {Object} value
 * @return {Promise}
 */
function del(key) {
  return baseQuery(key)
    .where('id', key)
    .del();
}

/**
 * [batch description]
 * @param  {[type]} ops [description]
 * @return {[type]}     [description]
 */
function batch(ops) {
  var commands = [];

  for (let i = 0; i < ops.length; i++) {
    let { key, value } = ops[i],
      { table, schema } = findSchemaAndTable(key);

    commands.push(onConflictPut(key, wrapJSONStringInObject(key, value), 'data', schema, table));
  }

  return Promise.all(commands);
}

/**
 * Return a readable stream of query results
 * from the db
 *
 * @param  {Object} options
 * @return {Stream}
 */
function createReadStream(options) {
  const { prefix, values, keys } = options,
    transform = TransformStream(options),
    selects = [];

  if (keys) selects.push('id');
  if (values) selects.push('data');

  baseQuery(prefix)
    .select(...selects)
    .where('id', 'like', `${prefix}%`)
    .pipe(transform);

  return transform;
}

/**
 * [putMeta description]
 * @param  {[type]} key   [description]
 * @param  {[type]} value [description]
 * @return {[type]}       [description]
 */
function getMeta(key) {
  return baseQuery(key)
    .select('meta')
    .where('id', key)
    .then(pullValFromRows(key, 'meta'));
}

/**
 * Creates a table with the name that's
 * passed into the function. Table has
 * an `id` (text) and `data` (jsonb) columns
 *
 * @param {String} table
 * @returns {Promise}
 */
function createTable(table) {
  return knex.raw('CREATE TABLE IF NOT EXISTS ?? ( id TEXT PRIMARY KEY NOT NULL, data JSONB, meta JSONB );', [table]);
}

/**
 * Creates a table with the name that's
 * passed into the function. Table has
 * an `id` (text), `data` (jsonb) column,
 * and `meta` (jsonb) columns
 *
 * @param {String} table
 * @returns {Promise}
 */
function createTableWithMeta(table) {
  return knex.raw('CREATE TABLE IF NOT EXISTS ?? ( id TEXT PRIMARY KEY NOT NULL, data JSONB, meta JSONB );', [table]);

}

/**
 * Creates a Postgres schema with the
 * name passed into the function
 *
 * @param {String} name
 * @returns {Promise}
 */
function createSchema(name) {
  return knex.raw('CREATE SCHEMA IF NOT EXISTS ??;', [name]);
}



module.exports.connect = connect;
module.exports.put = put;
module.exports.get = get;
module.exports.del = del;
module.exports.patch = patch('data');
module.exports.batch = batch;
module.exports.getMeta = getMeta;
module.exports.putMeta = META_PUT_PATCH_FN;
module.exports.patchMeta = META_PUT_PATCH_FN;
module.exports.createReadStream = createReadStream;

// Knex methods
module.exports.createSchema = createSchema;
module.exports.createTable = createTable;
module.exports.createTableWithMeta = createTableWithMeta;

// For testing
module.exports.setClient = mock => client = mock;

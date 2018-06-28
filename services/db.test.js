'use strict';

const { put, get, del, batch, createReadStream } = require('./db'),
  redis = require('../redis'),
  postgres = require('../postgres/client');

jest.mock('../redis');
jest.mock('../postgres/client');

describe('services/db', () => {
  const KEY = 'somekey',
    VALUE = { foo: true, bar: false },
    OPS = [{ key: KEY, value: JSON.stringify(VALUE) }];

  describe('get', () => {
    test('it does not call Postgres client if Redis has the data', () => {
      redis.get.mockResolvedValue(JSON.stringify(VALUE));

      return get(KEY).then(() => {
        expect(redis.get.mock.calls.length).toBe(1);
        expect(redis.get).toHaveBeenCalledWith(KEY);
        expect(postgres.get.mock.calls.length).toBe(0);
      });
    });

    test('it does call Postgres client if Redis has the data', () => {
      redis.get.mockResolvedValue(Promise.reject());

      return get(KEY).then(() => {
        expect(redis.get.mock.calls.length).toBe(1);
        expect(postgres.get.mock.calls.length).toBe(1);
        expect(redis.get).toHaveBeenCalledWith(KEY);
        expect(postgres.get).toHaveBeenCalledWith(KEY);
      });
    });
  });

  describe('put', () => {
    test('it calls the `put` method for both Redis and Postgres', () => {
      redis.put.mockResolvedValue(Promise.resolve());
      postgres.put.mockResolvedValue(Promise.resolve());

      return put(KEY, VALUE).then(() => {
        expect(redis.put.mock.calls.length).toBe(1);
        expect(postgres.put.mock.calls.length).toBe(1);
        expect(redis.put).toHaveBeenCalledWith(KEY, VALUE);
        expect(postgres.put).toHaveBeenCalledWith(KEY, VALUE);
      });
    });
  });

  describe('del', () => {
    test('it calls the `del` method for both Redis and Postgres', () => {
      redis.del.mockResolvedValue(Promise.resolve());
      postgres.del.mockResolvedValue(Promise.resolve());

      return del(KEY).then(() => {
        expect(redis.del.mock.calls.length).toBe(1);
        expect(postgres.del.mock.calls.length).toBe(1);
        expect(redis.del).toHaveBeenCalledWith(KEY);
        expect(postgres.del).toHaveBeenCalledWith(KEY);
      });
    });
  });

  describe('batch', () => {
    test('it calls the `batch` method for both Redis and Postgres', () => {
      redis.batch.mockResolvedValue(Promise.resolve());
      postgres.batch.mockResolvedValue(Promise.resolve());

      return batch(OPS).then(() => {
        expect(redis.batch.mock.calls.length).toBe(1);
        expect(postgres.batch.mock.calls.length).toBe(1);
        expect(redis.batch).toHaveBeenCalledWith(OPS);
        expect(postgres.batch).toHaveBeenCalledWith(OPS);
      });
    });
  });

  describe('createReadStream', () => {
    test('it calls the `createReadStream` method only Postgres', () => {
      createReadStream();
      expect(postgres.createReadStream.mock.calls.length).toBe(1);
    });
  });
});

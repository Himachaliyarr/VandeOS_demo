import { AsyncLocalStorage } from 'node:async_hooks';
import mongoose from 'mongoose';

const tenantStorage = new AsyncLocalStorage();

export function getTenantConnection() {
  return tenantStorage.getStore() || mongoose.connection;
}

export function runWithTenant(connection, callback) {
  return tenantStorage.run(connection, callback);
}

export function connectionForTenant(tenant) {
  if (mongoose.connection.readyState !== 1 || tenant.dbName === mongoose.connection.name) return mongoose.connection;
  return mongoose.connection.useDb(tenant.dbName, { useCache: true });
}

export function tenantModel(name, schema) {
  const resolveModel = () => {
    const connection = getTenantConnection();
    return connection.models[name] || connection.model(name, schema);
  };

  return new Proxy(function tenantModelProxy() {}, {
    apply(_target, thisArg, args) {
      return Reflect.apply(resolveModel(), thisArg, args);
    },
    construct(_target, args) {
      return Reflect.construct(resolveModel(), args);
    },
    get(_target, property) {
      const model = resolveModel();
      const value = Reflect.get(model, property, model);
      return typeof value === 'function' ? value.bind(model) : value;
    },
    set(_target, property, value) {
      return Reflect.set(resolveModel(), property, value);
    }
  });
}

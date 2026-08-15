import {
  isSoloCheckpointStorageExpired,
  parseSoloRecoveryCheckpoint,
  validateSoloRecoveryCheckpoint,
} from './soloRecoveryCheckpoint.js'
import { isValidSoloIdentityKey } from './soloRecoveryIdentity.js'

export const SOLO_RECOVERY_DATABASE_NAME = 'route-catch-recovery'
export const SOLO_RECOVERY_DATABASE_VERSION = 1
export const SOLO_RECOVERY_OBJECT_STORE = 'solo-checkpoints'

function recoveryFailure(operation, error) {
  return {
    ok: false,
    operation,
    error: error instanceof Error ? error : new Error(String(error)),
  }
}

function requestAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'))
  })
}

function transactionAsPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(
      transaction.error || new Error('IndexedDB transaction was aborted'),
    )
    transaction.onerror = () => {
      // onabort carries the final transaction failure.
    }
  })
}

export function createSoloRecoveryStore({
  indexedDb = globalThis.indexedDB,
  databaseName = SOLO_RECOVERY_DATABASE_NAME,
  databaseFactory = null,
} = {}) {
  let databasePromise = null

  function cacheDatabasePromise(promise) {
    let cachedPromise
    cachedPromise = promise
      .then((database) => {
        database.onversionchange = () => {
          database.close()

          if (databasePromise === cachedPromise) {
            databasePromise = null
          }
        }
        return database
      })
      .catch((error) => {
        if (databasePromise === cachedPromise) {
          databasePromise = null
        }
        throw error
      })
    databasePromise = cachedPromise
    return cachedPromise
  }

  function openDatabase() {
    if (databaseFactory) {
      if (!databasePromise) {
        return cacheDatabasePromise(Promise.resolve().then(databaseFactory))
      }

      return databasePromise
    }

    if (!indexedDb || typeof indexedDb.open !== 'function') {
      return Promise.reject(new Error('IndexedDB is unavailable'))
    }

    if (databasePromise) {
      return databasePromise
    }

    return cacheDatabasePromise(new Promise((resolve, reject) => {
      let request

      try {
        request = indexedDb.open(
          databaseName,
          SOLO_RECOVERY_DATABASE_VERSION,
        )
      } catch (error) {
        reject(error)
        return
      }

      request.onupgradeneeded = () => {
        const database = request.result

        if (!database.objectStoreNames.contains(SOLO_RECOVERY_OBJECT_STORE)) {
          database.createObjectStore(SOLO_RECOVERY_OBJECT_STORE, {
            keyPath: 'identityKey',
          })
        }
      }
      request.onsuccess = () => {
        resolve(request.result)
      }
      request.onerror = () => reject(
        request.error || new Error('Could not open the recovery database'),
      )
      request.onblocked = () => reject(
        new Error('Recovery database upgrade is blocked'),
      )
    }))
  }

  async function deleteRecord(identityKey) {
    if (!isValidSoloIdentityKey(identityKey)) {
      return recoveryFailure('delete', new TypeError('Invalid SOLO identity key'))
    }

    try {
      const database = await openDatabase()
      const transaction = database.transaction(
        SOLO_RECOVERY_OBJECT_STORE,
        'readwrite',
      )
      transaction.objectStore(SOLO_RECOVERY_OBJECT_STORE).delete(identityKey)
      await transactionAsPromise(transaction)
      return { ok: true, operation: 'delete' }
    } catch (error) {
      return recoveryFailure('delete', error)
    }
  }

  return {
    async read(identityKey, { deleteInvalid = true } = {}) {
      if (!isValidSoloIdentityKey(identityKey)) {
        return recoveryFailure('read', new TypeError('Invalid SOLO identity key'))
      }

      try {
        const database = await openDatabase()
        const transaction = database.transaction(
          SOLO_RECOVERY_OBJECT_STORE,
          'readonly',
        )
        const record = await requestAsPromise(
          transaction.objectStore(SOLO_RECOVERY_OBJECT_STORE).get(identityKey),
        )

        if (record === undefined) {
          return { ok: true, operation: 'read', checkpoint: null }
        }

        const parsed = parseSoloRecoveryCheckpoint(record, {
          expectedIdentityKey: identityKey,
        })

        if (!parsed.ok) {
          if (!deleteInvalid) {
            return {
              ok: true,
              operation: 'read',
              checkpoint: null,
              discardedReason: 'invalid',
              cleanupRequired: true,
              error: parsed.error,
            }
          }
          const deletion = await deleteRecord(identityKey)
          return {
            ok: deletion.ok,
            operation: 'read',
            checkpoint: null,
            discardedReason: 'invalid',
            error: deletion.ok ? parsed.error : deletion.error,
          }
        }

        return {
          ok: true,
          operation: 'read',
          checkpoint: parsed.checkpoint,
        }
      } catch (error) {
        return {
          ...recoveryFailure('read', error),
          checkpoint: null,
        }
      }
    },

    async replace(identityKey, checkpoint) {
      try {
        const validated = validateSoloRecoveryCheckpoint(checkpoint, {
          expectedIdentityKey: identityKey,
        })
        const database = await openDatabase()
        const transaction = database.transaction(
          SOLO_RECOVERY_OBJECT_STORE,
          'readwrite',
        )
        transaction.objectStore(SOLO_RECOVERY_OBJECT_STORE).put(validated)
        await transactionAsPromise(transaction)
        return { ok: true, operation: 'replace' }
      } catch (error) {
        return recoveryFailure('replace', error)
      }
    },

    delete: deleteRecord,

    async sweep(identityKey, nowEpochMs = Date.now()) {
      if (!isValidSoloIdentityKey(identityKey)) {
        return recoveryFailure('sweep', new TypeError('Invalid SOLO identity key'))
      }

      try {
        const database = await openDatabase()
        const transaction = database.transaction(
          SOLO_RECOVERY_OBJECT_STORE,
          'readwrite',
        )
        const objectStore = transaction.objectStore(
          SOLO_RECOVERY_OBJECT_STORE,
        )
        const record = await requestAsPromise(objectStore.get(identityKey))
        const deletedIdentityKeys = []

        if (record !== undefined) {
          const parsed = parseSoloRecoveryCheckpoint(record, {
            expectedIdentityKey: identityKey,
          })
          const shouldDelete =
            !parsed.ok ||
            isSoloCheckpointStorageExpired(parsed.checkpoint, nowEpochMs)

          if (shouldDelete) {
            objectStore.delete(identityKey)
            deletedIdentityKeys.push(identityKey)
          }
        }

        await transactionAsPromise(transaction)
        return {
          ok: true,
          operation: 'sweep',
          deletedIdentityKeys,
        }
      } catch (error) {
        return recoveryFailure('sweep', error)
      }
    },

    close() {
      if (!databasePromise) {
        return
      }

      void databasePromise.then((database) => database.close()).catch(() => {})
      databasePromise = null
    },
  }
}

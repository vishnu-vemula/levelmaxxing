package org.levelmaxing.app

import android.database.Cursor
import androidx.sqlite.db.SimpleSQLiteQuery
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableType
import java.io.File
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.UUID
import java.util.concurrent.Executors
import net.zetetic.database.sqlcipher.SQLiteDatabase

class StorageModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    companion object { const val NAME = "LevelmaxingStorage" }

    private val worker = Executors.newSingleThreadExecutor()
    private val databases = mutableMapOf<String, SQLiteDatabase>()
    private val secrets by lazy { DeviceSecrets(context) }
    private val random = SecureRandom()

    override fun getName() = NAME

    override fun getConstants(): Map<String, Any> = mapOf("appVersion" to BuildConfig.VERSION_NAME)

    @ReactMethod(isBlockingSynchronousMethod = true)
    fun randomUUID(): String = UUID.randomUUID().toString()

    @ReactMethod
    fun digest(value: String, promise: Promise) = asynchronously(promise) {
        hex(MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)))
    }

    @ReactMethod
    fun readSecret(id: String, promise: Promise) = asynchronously(promise) { secrets.read(historyId(id)) }

    @ReactMethod
    fun writeSecret(id: String, value: String, promise: Promise) = asynchronously(promise) {
        secrets.write(historyId(id), value)
        null
    }

    @ReactMethod
    fun deleteSecret(id: String, promise: Promise) = asynchronously(promise) {
        secrets.delete(historyId(id))
        null
    }

    @ReactMethod
    fun open(namespace: String, promise: Promise) = asynchronously(promise) {
        require(Regex("lm\\.(session|progress|workspace)\\.[a-f0-9]{64}").matches(namespace))
        System.loadLibrary("sqlcipher")
        val directory = File(context.noBackupFilesDir, "LevelmaxingPrivate")
        check(directory.isDirectory || directory.mkdirs())
        val file = File(directory, "$namespace.sqlite")
        val key = secrets.read(namespace) ?: run {
            check(!file.exists() && !File(directory, "${file.name}-wal").exists())
            hex(ByteArray(32).also(random::nextBytes)).also { secrets.write(namespace, it) }
        }
        require(Regex("[a-f0-9]{64}").matches(key))
        val database = SQLiteDatabase.openOrCreateDatabase(file, "x'$key'", null,
            { _, _ -> error("Encrypted database is unavailable") }, null)
        try {
            database.rawQuery("PRAGMA cipher_version", emptyArray()).use { cursor -> check(cursor.moveToFirst()) }
            database.rawQuery("SELECT name FROM sqlite_master LIMIT 1", emptyArray()).use { it.moveToFirst() }
            database.rawQuery("PRAGMA cipher_status", emptyArray()).use { cursor ->
                check(cursor.moveToFirst() && cursor.getInt(0) == 1)
            }
        } catch (error: Exception) {
            database.close()
            throw error
        }
        val connection = UUID.randomUUID().toString()
        databases[connection] = database
        connection
    }

    @ReactMethod
    fun execute(connection: String, sql: String, promise: Promise) = asynchronously(promise) {
        val database = databases.getValue(connection)
        when (sql.uppercase()) {
            "BEGIN IMMEDIATE" -> database.beginTransactionNonExclusive()
            "COMMIT" -> {
                database.setTransactionSuccessful()
                database.endTransaction()
            }
            "ROLLBACK" -> if (database.inTransaction()) database.endTransaction() else Unit
            "PRAGMA JOURNAL_MODE = WAL" -> check(database.enableWriteAheadLogging())
            else -> database.rawExecSQL(sql)
        }
        null
    }

    @ReactMethod
    fun run(connection: String, sql: String, values: ReadableArray, promise: Promise) = asynchronously(promise) {
        databases.getValue(connection).execSQL(sql, bindings(values))
        null
    }

    @ReactMethod
    fun query(connection: String, sql: String, values: ReadableArray, promise: Promise) = asynchronously(promise) {
        val result = Arguments.createArray()
        databases.getValue(connection).query(SimpleSQLiteQuery(sql, bindings(values))).use { cursor ->
            while (cursor.moveToNext()) {
                val row = Arguments.createMap()
                for (index in 0 until cursor.columnCount) {
                    val name = cursor.getColumnName(index)
                    when (cursor.getType(index)) {
                        Cursor.FIELD_TYPE_NULL -> row.putNull(name)
                        Cursor.FIELD_TYPE_INTEGER, Cursor.FIELD_TYPE_FLOAT -> row.putDouble(name, cursor.getDouble(index))
                        Cursor.FIELD_TYPE_STRING -> row.putString(name, cursor.getString(index))
                        else -> error("Unsupported database result")
                    }
                }
                result.pushMap(row)
            }
        }
        result
    }

    @ReactMethod
    fun close(connection: String, promise: Promise) = asynchronously(promise) {
        databases.remove(connection)?.let(::closeDatabase)
        null
    }

    override fun invalidate() {
        worker.execute { databases.values.forEach(::closeDatabase); databases.clear() }
        worker.shutdown()
        super.invalidate()
    }

    private fun closeDatabase(database: SQLiteDatabase) {
        try {
            if (database.inTransaction()) database.endTransaction()
        } finally {
            database.close()
        }
    }

    private fun bindings(values: ReadableArray): Array<Any?> = Array(values.size()) { index ->
        when (values.getType(index)) {
            ReadableType.Null -> null
            ReadableType.String -> values.getString(index)
            ReadableType.Number -> values.getDouble(index)
            else -> error("Unsupported database parameter")
        }
    }

    private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it.toInt() and 0xff) }

    private fun historyId(id: String): String {
        require(id.startsWith("lm.history-move."))
        return id
    }

    private fun asynchronously(promise: Promise, operation: () -> Any?) {
        worker.execute {
            try {
                promise.resolve(operation())
            } catch (_: Exception) {
                promise.reject("LOCAL_STORAGE", "The native storage operation could not be completed.")
            } catch (_: LinkageError) {
                promise.reject("LOCAL_STORAGE", "This build requires the native SQLCipher library.")
            }
        }
    }
}

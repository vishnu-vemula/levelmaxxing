package org.levelmaxing.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

/** Keeps the application's existing encrypted preference format and Android KeyStore aliases. */
internal class DeviceSecrets(context: Context) {
    private val preferences = context.getSharedPreferences("SecureStore", Context.MODE_PRIVATE)
    private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    fun read(id: String): String? {
        validateId(id)
        val encrypted = preferences.getString("key_v1-$id", null) ?: preferences.getString(id, null) ?: return null
        val record = JSONObject(encrypted)
        require(record.getString("scheme") == "aes" && !record.optBoolean("requireAuthentication"))
        require(record.getInt("tlen") == 128)
        val alias = if (record.optBoolean("usesKeystoreSuffix")) CURRENT_ALIAS else BASE_ALIAS
        val key = keyStore.getKey(alias, null) as? SecretKey ?: error("The device key is unavailable")
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, Base64.decode(record.getString("iv"), Base64.DEFAULT)))
        return cipher.doFinal(Base64.decode(record.getString("ct"), Base64.DEFAULT)).toString(Charsets.UTF_8)
    }

    fun write(id: String, value: String) {
        validateId(id)
        val key = keyStore.getKey(CURRENT_ALIAS, null) as? SecretKey ?: createKey()
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key)
        val ciphertext = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val record = JSONObject()
            .put("scheme", "aes")
            .put("ct", Base64.encodeToString(ciphertext, Base64.NO_WRAP))
            .put("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .put("tlen", 128)
            .put("keystoreAlias", "key_v1")
            .put("requireAuthentication", false)
            .put("usesKeystoreSuffix", true)
        check(preferences.edit().putString("key_v1-$id", record.toString()).commit())
    }

    fun delete(id: String) {
        validateId(id)
        check(preferences.edit().remove("key_v1-$id").remove(id).commit())
    }

    private fun validateId(id: String) {
        require(Regex("lm\\.(session|progress|workspace|history-move)\\.[a-f0-9]{64}").matches(id))
    }

    private fun createKey(): SecretKey {
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(CURRENT_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setKeySize(256)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .build())
        return generator.generateKey()
    }

    private companion object {
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val BASE_ALIAS = "$TRANSFORMATION:key_v1"
        const val CURRENT_ALIAS = "$BASE_ALIAS:keystoreUnauthenticated"
    }
}

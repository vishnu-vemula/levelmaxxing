package org.levelmaxing.privatestorage

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.IOException

class LevelmaxingPrivateStorageModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("LevelmaxingPrivateStorage")

        AsyncFunction("directory") {
            val context = appContext.reactContext ?: throw IOException("Private storage is unavailable")
            val directory = File(context.noBackupFilesDir, "LevelmaxingPrivate")
            if (!directory.isDirectory && !directory.mkdirs() && !directory.isDirectory) {
                throw IOException("Private storage is unavailable")
            }
            directory.absolutePath
        }
    }
}

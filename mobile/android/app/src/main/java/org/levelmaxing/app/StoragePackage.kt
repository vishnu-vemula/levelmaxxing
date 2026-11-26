package org.levelmaxing.app

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class StoragePackage : BaseReactPackage() {
    override fun getModule(name: String, context: ReactApplicationContext): NativeModule? =
        if (name == StorageModule.NAME) StorageModule(context) else null

    override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
        mapOf(StorageModule.NAME to ReactModuleInfo(
            StorageModule.NAME, StorageModule::class.java.name, false, false, false, false
        ))
    }
}

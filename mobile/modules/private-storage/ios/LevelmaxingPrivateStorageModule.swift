import ExpoModulesCore
import Foundation

public final class LevelmaxingPrivateStorageModule: Module {
    public func definition() -> ModuleDefinition {
        Name("LevelmaxingPrivateStorage")

        AsyncFunction("directory") { () throws -> String in
            let manager = FileManager.default
            let support = try manager.url(
                for: .applicationSupportDirectory,
                in: .userDomainMask,
                appropriateFor: nil,
                create: true
            )
            var directory = support.appendingPathComponent("LevelmaxingPrivate", isDirectory: true)
            try manager.createDirectory(
                at: directory,
                withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]
            )
            var attributes = URLResourceValues()
            attributes.isExcludedFromBackup = true
            try directory.setResourceValues(attributes)
            guard try directory.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true else {
                throw CocoaError(.fileWriteNoPermission)
            }
            return directory.path
        }
    }
}

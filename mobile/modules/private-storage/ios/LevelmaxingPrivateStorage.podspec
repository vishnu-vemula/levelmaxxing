Pod::Spec.new do |s|
  s.name           = 'LevelmaxingPrivateStorage'
  s.version        = '0.1.0'
  s.summary        = 'Backup-excluded app storage for Levelmaxing'
  s.description    = 'Provides the private directory used by SQLCipher.'
  s.homepage       = 'https://docs.expo.dev/modules/overview/'
  s.license        = { :type => 'Proprietary' }
  s.author         = 'Levelmaxing'
  s.source         = { :path => '.' }
  s.platform       = :ios, '16.4'
  s.swift_version  = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
end

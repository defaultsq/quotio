import Foundation
import QuotioDomain

public enum AccountServiceFailure: Error, Equatable, Sendable {
    case invalidCredential
    case duplicateAccount
    case accountNotFound
    case deletionNotAllowed
}

public enum NativeSourceAuthorizationFailure: Error, Equatable, Sendable {
    case quotioVault
    case nativeKeychain
    case nativeLogin
    case invalidCredential
    case timeout
    case unknown
}

/// One login inside a config directory that holds several, such as a multi-account `GROK_HOME`.
public struct LocalAccountEntry: Equatable, Identifiable, Sendable {
    public let entryKey: String
    public let label: String
    public var id: String { entryKey }

    public init(entryKey: String, label: String) {
        self.entryKey = entryKey
        self.label = label
    }
}

public enum LocalAccountFailure: Error, Equatable, Sendable {
    case entryRequired([LocalAccountEntry])
    case invalidInput
    case notSignedIn
    case duplicateAccount
    case keychainAccess
    case invalidCredential
    case unknown
}

/// Why the host cannot read Quotio's own account store. Only `requiresAuthorization`
/// is something the user can fix in place; the other cases need a different Quotio.
public enum AccountStorageProblem: Equatable, Sendable {
    case requiresAuthorization
    case unreadable
    case newerVersion
}

public struct NativeSourcePermission: Codable, Hashable, Identifiable, Sendable {
    public let provider: QuotaProvider
    public let kind: String
    public let location: String?
    public let keychainAccount: String?
    public let configDirectory: String?

    public init(provider: QuotaProvider, kind: String, location: String?, keychainAccount: String? = nil,
                configDirectory: String? = nil) {
        self.provider = provider
        self.kind = kind
        self.location = location
        self.keychainAccount = keychainAccount
        self.configDirectory = configDirectory
    }

    public var id: String {
        provider.rawValue + ":" + kind + ":" + (location ?? "") + ":" + (keychainAccount ?? "") + ":" + (configDirectory ?? "")
    }
}

public struct NativeDiscoverySnapshot: Sendable {
    public let failedProviders: Set<QuotaProvider>
    public let permissions: [NativeSourcePermission]
    public let knownSources: [NativeSourcePermission]
    public let scannedAt: [QuotaProvider: Date]

    public init(permissions: [NativeSourcePermission] = [], knownSources: [NativeSourcePermission] = [], scannedAt: [QuotaProvider: Date] = [:], failedProviders: Set<QuotaProvider> = []) {
        self.failedProviders = failedProviders
        self.permissions = permissions
        self.knownSources = knownSources
        self.scannedAt = scannedAt
    }
}

public protocol AccountManaging: Sendable {
    func registerDetectedNativeAccounts() async
    func rescanNativeAccounts(for provider: QuotaProvider) async
    func rescanAllNativeAccounts() async
    func nativeDiscoverySnapshot() async -> NativeDiscoverySnapshot
    func authorizeNativeSource(_ source: NativeSourcePermission) async throws
    /// Registers the read-only login a tool keeps in `configDirectory`, asking macOS for
    /// Keychain access when that login lives in the Keychain.
    func addLocalAccount(provider: QuotaProvider, kind: String, configDirectory: String, entryKey: String?, label: String?) async throws
    func accountStorageProblem() async -> AccountStorageProblem?
    func authorizeAccountStorage() async throws
    func accounts() async -> [Account]
    func setDisabled(_ disabled: Bool, accountID: String) async
    func delete(accountID: String) async throws
    func renameResolvedAccount(id: String, userLabel: String?) async throws
    func setSourceEnabled(_ enabled: Bool, sourceID: String) async throws
    func unlinkSource(sourceID: String) async throws
    func saveAPIKey(
        providerID: AccountProviderID,
        label: String,
        apiKey: String,
        existingAccountID: String?,
        fields: [String: String]
    ) async throws
}

public extension AccountManaging {
    func rescanAllNativeAccounts() async { await registerDetectedNativeAccounts() }
    func nativeDiscoverySnapshot() async -> NativeDiscoverySnapshot { .init() }
    func accountStorageProblem() async -> AccountStorageProblem? { nil }
    func authorizeAccountStorage() async throws { throw NativeSourceAuthorizationFailure.unknown }
    func addLocalAccount(provider: QuotaProvider, kind: String, configDirectory: String, entryKey: String?, label: String?) async throws {
        throw LocalAccountFailure.unknown
    }
}

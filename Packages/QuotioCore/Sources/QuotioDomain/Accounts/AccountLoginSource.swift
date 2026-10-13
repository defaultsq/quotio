public struct AccountLoginSource: Codable, Hashable, Identifiable, Sendable {
    public let accountID: String
    public let source: AccountSource
    public let credentialReference: String?
    public let status: AccountStatus
    public let location: String?
    public let keychainAccount: String?
    /// User-chosen config directory the login is read from, such as `CLAUDE_CONFIG_DIR`.
    public let directory: String?
    public let enabled: Bool?
    public let actions: Set<String>?

    public var id: String { accountID + ":" + source.rawValue + ":" + (credentialReference ?? "") }

    public init(accountID: String, source: AccountSource, credentialReference: String?, status: AccountStatus, location: String? = nil, enabled: Bool? = nil, actions: Set<String>? = nil, keychainAccount: String? = nil, directory: String? = nil) {
        self.accountID = accountID
        self.source = source
        self.credentialReference = credentialReference
        self.status = status
        self.location = location
        self.keychainAccount = keychainAccount
        self.directory = directory
        self.enabled = enabled
        self.actions = actions
    }
}

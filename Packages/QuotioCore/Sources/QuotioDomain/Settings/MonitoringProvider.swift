public struct MonitoringProvider: Identifiable, Equatable, Sendable {
    public struct Input: Identifiable, Equatable, Sendable {
        public var id: String { fieldPath }
        public let name: String
        public let fieldPath: String
        public let required: Bool
        public let values: [String]?

        public init(name: String, fieldPath: String, required: Bool, values: [String]?) {
            self.name = name
            self.fieldPath = fieldPath
            self.required = required
            self.values = values
        }
    }
    /// A local login the tool keeps in a directory other than its default, selected
    /// by `environmentVariable` (for example `CLAUDE_CONFIG_DIR`).
    public struct ConfigDirectorySource: Equatable, Sendable {
        public let kind: String
        public let environmentVariable: String

        public init(kind: String, environmentVariable: String) {
            self.kind = kind
            self.environmentVariable = environmentVariable
        }
    }
    public let id: QuotaProvider
    public let displayName: String
    public let actions: Set<String>
    public let inputs: [Input]
    public let configDirectorySource: ConfigDirectorySource?

    public init(id: QuotaProvider, displayName: String, actions: Set<String>, inputs: [Input], configDirectorySource: ConfigDirectorySource? = nil) {
        self.id = id
        self.displayName = displayName
        self.actions = actions
        self.inputs = inputs
        self.configDirectorySource = configDirectorySource
    }
}

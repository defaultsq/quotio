public struct QuotioHostProviders: Decodable, Sendable {
    public struct Provider: Decodable, Sendable {
        public struct Capabilities: Decodable, Sendable {
            public struct Setting: Decodable, Sendable {
                public let name: String
                public let fieldPath: String
                public let required: Bool
                public let values: [String]?
            }
            public struct SourceReference: Decodable, Sendable {
                public let kind: String
                /// Environment variable naming the tool's config directory; present
                /// when `POST v2/sources` accepts `config_dir` for this kind.
                public let configDirEnv: String?
            }
            public let settings: [Setting]
            public let operations: [String]
            public let sourceReferences: [SourceReference]?
        }
        public let id: String
        public let displayName: String
        public let actions: [QuotioHostSnapshot.Action]
        public let capabilities: Capabilities
    }
    public let schemaVersion: Int
    public let providers: [Provider]
}

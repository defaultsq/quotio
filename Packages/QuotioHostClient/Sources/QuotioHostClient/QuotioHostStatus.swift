import Foundation

public struct QuotioHostStatus: Decodable, Sendable {
    public let schemaVersion: Int
    public let apiVersion: Int
    public let clientId: String
    public let accessMode: String
    public let ready: Bool
    public let refreshing: Bool
    /// Absent while a refresh runs and whenever scheduled refresh is off.
    public let nextRefreshAt: Date?
}

extension QuotioHostHTTPClient {
    public func status() async throws -> QuotioHostStatus {
        let value: QuotioHostStatus = try await request("v2/status")
        guard value.schemaVersion == 2, value.apiVersion == 2 else {
            throw QuotioHostClientError.incompatible
        }
        return value
    }
}

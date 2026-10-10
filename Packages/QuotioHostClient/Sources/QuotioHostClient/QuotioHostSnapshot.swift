import Foundation

/// Decoder for the resolved Rust contract. No provider policy belongs in these DTOs.
public struct QuotioHostSnapshot: Decodable, Sendable {
    public struct Availability: Decodable, Sendable {
        public let available: Bool
        public let reason: String?
    }
    public struct Host: Decodable, Sendable {
        public let id: String
        public let platform: String
        public let apiVersions: [Int]
        public let capabilities: [String: Availability]
    }
    public struct Action: Decodable, Sendable {
        public let kind: String
        public let available: Bool
        public let reason: String?
        public let interaction: String
    }
    public struct Issue: Decodable, Sendable {
        public let code: String
        public let retryable: Bool
        public let action: Action?
    }
    public struct Identity: Decodable, Sendable {
        public let evidence: String
        public let username: String?
        public let email: String?
    }
    public struct Source: Decodable, Sendable {
        public let id: String
        public let origin: String
        public let kind: String
        public let location: String?
        public let keychainAccount: String?
        public let enabled: Bool
        public let selected: Bool
        public let state: String
        public let refreshOwner: String
        public let issue: Issue?
        public let actions: [Action]
    }
    public struct Account: Decodable, Sendable {
        public let id: String
        public let providerId: String
        public let displayName: String
        public let userLabel: String?
        public let identity: Identity
        public let enabled: Bool
        public let active: Bool
        public let state: String
        public let sources: [Source]
        public let actions: [Action]
    }
    public struct Quota: Decodable, Sendable {
        public let state: String
        public let remainingPercent: Double?
        public let amount: Double?
        public let unit: String?
    }
    public struct Amounts: Decodable, Sendable {
        public let remaining: Double
        public let limit: Double?
        public let unit: String
    }
    public struct Consumption: Decodable, Sendable {
        public let used: Double
        public let unit: String
    }
    public struct Metric: Decodable, Sendable {
        public let id: String
        public let group: String?
        public let displayName: String
        public let note: String?
        public let quota: Quota
        public let amounts: Amounts?
        public let consumption: Consumption?
        public let resetsAt: Date?
        public let resetDescription: String?
        public let windowSeconds: Double?
        public let fetchedAt: Date
    }
    public struct Summary: Decodable, Sendable {
        public struct Totals: Decodable, Sendable {
            public let lowest: Double?
            public let average: Double?
        }
        public struct Metric: Decodable, Sendable {
            public let displayName: String
            public let remainingPercent: Double?
        }
        public let sessionOnly: Totals
        public let combined: Totals
        public let pair: [Metric]
    }
    public struct Usage: Decodable, Sendable {
        public let accountId: String
        public let freshness: String
        public let fetchedAt: Date?
        public let expiresAt: Date?
        public let plan: String?
        public let subscriptionStatus: String?
        public let resetCredits: QuotioHostResetCredits?
        public let codexProfile: QuotioHostCodexProfile?
        public let codexResetCredits: QuotioHostCodexResetCredits?
        public let antigravitySubscription: QuotioHostSubscription?
        public let metrics: [Metric]
        public let summary: Summary?
        public let issue: Issue?
    }
    public let schemaVersion: Int
    public let host: Host
    public let revision: UInt64
    public let generatedAt: Date
    public let accounts: [Account]
    public let accountRedirects: [String: String]?
    public let usage: [Usage]
    public let providerIssues: [String: Issue]?

    public static func decode(_ data: Data) throws -> Self {
        let value = try makeQuotioHostDecoder().decode(Self.self, from: data)
        try value.validate()
        return value
    }

    public func validate() throws {
        func validID(_ id: String) -> Bool {
            !id.isEmpty && id.utf8.count <= 256 && id.utf8.allSatisfy {
                ($0 >= 65 && $0 <= 90) || ($0 >= 97 && $0 <= 122) || ($0 >= 48 && $0 <= 57) || $0 == 45 || $0 == 95
            }
        }
        guard schemaVersion == 2, host.apiVersions.contains(2), validID(host.id) else { throw QuotioHostClientError.incompatible }
        let accountIDs = Set(accounts.map(\.id))
        guard accountIDs.count == accounts.count else { throw QuotioHostClientError.incompatible }
        var sourceIDs = Set<String>()
        for account in accounts {
            guard validID(account.id), !account.providerId.isEmpty, !account.displayName.isEmpty,
                  account.sources.filter(\.selected).count <= 1 else { throw QuotioHostClientError.incompatible }
            for source in account.sources {
                guard validID(source.id), sourceIDs.insert(source.id).inserted,
                      !source.selected || (source.enabled && account.enabled) else { throw QuotioHostClientError.incompatible }
            }
        }
        for (old, target) in accountRedirects ?? [:] {
            guard validID(old), !accountIDs.contains(old), accountIDs.contains(target) else { throw QuotioHostClientError.incompatible }
        }
        var usageIDs = Set<String>()
        for value in usage {
            if let summary = value.summary {
                let values = [summary.sessionOnly.lowest, summary.sessionOnly.average, summary.combined.lowest, summary.combined.average] + summary.pair.map(\.remainingPercent)
                guard values.compactMap { $0 }.allSatisfy({ $0.isFinite && (0...100).contains($0) }),
                      summary.pair.isEmpty || summary.pair.count == 2,
                      summary.pair.allSatisfy({ !$0.displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.displayName.utf8.count <= 512 && $0.displayName.rangeOfCharacter(from: .controlCharacters) == nil }) else { throw QuotioHostClientError.incompatible }
            }

            if ["fresh", "stale"].contains(value.freshness), value.fetchedAt == nil { throw QuotioHostClientError.incompatible }
            guard accountIDs.contains(value.accountId), usageIDs.insert(value.accountId).inserted,
                  Set(value.metrics.map(\.id)).count == value.metrics.count,
                  value.metrics.allSatisfy({ metric in
                      validID(metric.id) && (metric.group.map { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.utf8.count <= 512 && $0.rangeOfCharacter(from: .controlCharacters) == nil } ?? true)
                  }) else { throw QuotioHostClientError.incompatible }
            if let profile = value.codexProfile,
               Set(profile.dailyUsage.map(\.date)).count != profile.dailyUsage.count { throw QuotioHostClientError.incompatible }
        }
    }
}

public struct QuotioHostAccountList: Decodable, Sendable {
    public let schemaVersion: Int
    public let host: QuotioHostSnapshot.Host
    public let revision: UInt64
    public let accounts: [QuotioHostSnapshot.Account]
    public let accountRedirects: [String: String]?
}

/// Mutation scope comes from the resource the user selected, not a provider-specific rule.
public enum QuotioHostAccountTarget: Sendable {
    case account(String)
    case source(String)

    public var path: String {
        switch self {
        case .account(let id): "v2/accounts/\(id)"
        case .source(let id): "v2/sources/\(id)"
        }
    }
}

import Observation
import QuotioDomain

@MainActor
@Observable
public final class NavigationScreenModel {
    public var currentPage: NavigationPage = .providers {
        didSet {
            if currentPage != .providers { selectedProvider = nil }
        }
    }
    public var selectedProvider: QuotaProvider?
    /// An account whose quota history should open once the accounts page shows.
    public var requestedHistory: QuotaAccountID?

    public func selectProvider(_ provider: QuotaProvider) {
        currentPage = .providers
        selectedProvider = provider
    }

    public func showProviders() {
        selectedProvider = nil
        currentPage = .providers
    }

    public func showHistory(_ account: QuotaAccountID) {
        currentPage = .providers
        requestedHistory = account
    }

    public init() {}
}

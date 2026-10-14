import XCTest
import QuotioApplication
import QuotioDomain
@testable import QuotioPresentation

@MainActor
final class ConnectionPresentationTests: XCTestCase {
    func testNavigationDoesNotLeakProviderSelectionIntoOtherPages() {
        let navigation = NavigationScreenModel()
        XCTAssertEqual(navigation.currentPage, .providers)
        navigation.selectProvider(.amp)
        XCTAssertEqual(navigation.currentPage, .providers)
        XCTAssertEqual(navigation.selectedProvider, .amp)
        navigation.currentPage = .quota
        XCTAssertNil(navigation.selectedProvider)
        navigation.selectProvider(.kiro)
        navigation.showProviders()
        XCTAssertNil(navigation.selectedProvider)
        XCTAssertEqual(navigation.currentPage, .providers)
    }

    func testAccountsListKeepsTrackingOffProvidersInPlaceAndSearchesAccounts() {
        let providers: [MonitoringProvider] = [.amp, .claude, .codex, .kiro, .qwen].map {
            .init(id: $0, displayName: $0.displayName, actions: [], inputs: [])
        }
        let work = Account(identity: .make(providerID: .init(rawValue: "amp"), accountKey: "work"),
            displayName: "Work account", source: .nativeCredential)
        let personal = Account(identity: .make(providerID: .init(rawValue: "amp"), accountKey: "personal"),
            displayName: "Personal", source: .nativeCredential)
        let kiro = Account(identity: .make(providerID: .init(rawValue: "kiro"), accountKey: "kiro"),
            displayName: "Kiro login", source: .nativeCredential)
        let permission = NativeSourcePermission(provider: .claude, kind: "claude_native", location: "code_keychain")
        func list(_ search: String) -> AccountsSettingsList {
            AccountsSettingsList(providers: providers, accounts: [work, personal, kiro], permissions: [permission],
                quota: .init(), tracking: .init(disabledProviders: [.kiro, .qwen]), search: search)
        }
        let all = list("  ")
        XCTAssertEqual(all.connected.map(\.provider), [.amp, .claude, .kiro],
            "A provider with accounts stays in place when monitoring is off")
        XCTAssertEqual(all.unconnected.map(\.provider), [.codex, .qwen])
        XCTAssertEqual(all.visibleAccounts(in: all.connected[0]).map(\.displayName), ["Work account", "Personal"])

        let byAccount = list(" WORK ")
        XCTAssertEqual(byAccount.connected.map(\.provider), [.amp])
        XCTAssertEqual(byAccount.visibleAccounts(in: byAccount.connected[0]).map(\.displayName), ["Work account"])
        let byProvider = list("amp")
        XCTAssertEqual(byProvider.visibleAccounts(in: byProvider.connected[0]).count, 2)
        XCTAssertEqual(list("CODEX").unconnected.map(\.provider), [.codex])
        XCTAssertTrue(list("no match").isEmpty)
    }
}

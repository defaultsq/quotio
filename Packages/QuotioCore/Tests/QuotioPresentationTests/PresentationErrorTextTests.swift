import XCTest
@testable import QuotioApplication
@testable import QuotioDomain
@testable import QuotioPresentation

@MainActor
final class PresentationErrorTextTests: XCTestCase {
    func testOpaqueAgentDiagnosticsRemainUnchanged() {
        XCTAssertEqual(AgentConfigurationFailure.operationFailed(details: "Disk full").localizedText, "Disk full")
        XCTAssertEqual(
            AgentConnectionMessage.server(details: "Server unavailable").localizedText,
            "Server unavailable"
        )
        XCTAssertEqual(
            AgentConnectionMessage.transport(details: "Network offline").localizedText,
            "Network offline"
        )
    }

    func testProxyManagementErrorsMapToExistingMessages() {
        XCTAssertEqual(
            proxyManagementErrorMessage(ProxyManagementFailure.invalidResponse),
            "Invalid response"
        )
        XCTAssertEqual(
            proxyManagementErrorMessage(ProxyManagementFailure.connectionError("Offline")),
            "Connection error: Offline"
        )
    }
}

import Foundation
import QuotioDomain

public protocol MonitoringSettingsManaging: Sendable {
    func monitoringProviders() async throws -> [MonitoringProvider]
    func monitoringSettings() async throws -> MonitoringSettings
    func updateMonitoringSettings(_ settings: MonitoringSettings) async throws -> MonitoringSettings
    /// When the host next refreshes on its own; nil while a refresh runs or scheduling is off.
    func nextRefreshAt() async throws -> Date?
}

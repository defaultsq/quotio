import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type HistoryRange } from "@/lib/api/client";

const keys = {
  all: ["quota-history"],
  catalog: (accountId: string) => ["quota-history", accountId],
  chart: (accountId: string, metricId: string, range: HistoryRange) => ["quota-history", accountId, metricId, range],
} as const;

export function useHistoryCatalog(accountId: string) {
  return useQuery({ queryKey: keys.catalog(accountId), queryFn: () => api.historyCatalog(accountId) });
}

export function useHistoryChart(accountId: string, metricId: string | null, range: HistoryRange) {
  return useQuery({
    queryKey: keys.chart(accountId, metricId ?? "", range),
    queryFn: () => api.historyChart(accountId, metricId!, range),
    enabled: metricId !== null,
    refetchInterval: 60_000,
  });
}

export function useClearHistory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.clearHistory,
    onSettled: () => client.invalidateQueries({ queryKey: keys.all }),
  });
}

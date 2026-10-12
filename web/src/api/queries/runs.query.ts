import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { RunsService, type RunStartForm } from "../services/runs.service";

// Ход запуска меняется на глазах: телефоны поднимаются, проходят шаги и гаснут
const RUNS_REFETCH_MS = 5_000;

export const useGetRuns = () =>
  useQuery({
    queryKey: ["runs"],
    queryFn: () => RunsService.getRuns(),
    refetchInterval: RUNS_REFETCH_MS,
  });

// Запуск и остановка меняют и список запусков, и телефоны (появятся аккаунты)
const useRunsMutation = <TVariables = void, TData = unknown>(
  mutationFn: (variables: TVariables) => Promise<TData>,
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["runs"] });
      queryClient.invalidateQueries({ queryKey: ["farm-accounts"] });
    },
  });
};

export const useStartRun = () =>
  useRunsMutation((form: RunStartForm) => RunsService.start(form));

export const useCancelRun = () =>
  useRunsMutation((id: string) => RunsService.cancel(id));

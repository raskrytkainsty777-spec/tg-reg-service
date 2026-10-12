import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  FarmAccountListParams,
  FarmEmailListParams,
  FarmListParams,
  FarmResourceStatus,
  FarmService,
  FarmSettingsForm,
  FarmTrunkForm,
} from "../services/farm.service";

// Живые данные (локи транков, статус Asterisk) подтягиваем раз в 10 секунд,
// пока открыт соответствующий экран
const LIVE_REFETCH_MS = 10_000;

// Любое действие на ферме меняет счётчики обзора и шагов онбординга,
// поэтому после мутаций сбрасываем весь кэш фермы разом
const useFarmMutation = <TVariables = void, TData = unknown>(
  mutationFn: (variables: TVariables) => Promise<TData>
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["farm"] });
    },
  });
};

// ─── Обзор и настройки ────────────────────────────────────────────────────

export const useGetFarmOverview = (live = false) => {
  return useQuery({
    queryKey: ["farm", "overview"],
    queryFn: () => FarmService.getOverview(),
    refetchInterval: live ? LIVE_REFETCH_MS : false,
  });
};

export const useGetFarmSettings = () => {
  return useQuery({
    queryKey: ["farm", "settings"],
    queryFn: () => FarmService.getSettings(),
  });
};

export const useUpdateFarmSettings = () =>
  useFarmMutation((form: FarmSettingsForm) => FarmService.updateSettings(form));

export const useTestFarmSpeechkit = () =>
  useMutation({
    mutationFn: (key?: string) => FarmService.testSpeechkit(key),
  });

// ─── Прокси ───────────────────────────────────────────────────────────────

export const useGetFarmProxies = (params: FarmListParams) => {
  return useQuery({
    queryKey: ["farm", "proxies", params],
    queryFn: () => FarmService.getProxies(params),
    placeholderData: keepPreviousData,
  });
};

export const useImportFarmProxies = () =>
  useFarmMutation((text: string) => FarmService.importProxies(text));

export const useDeleteFarmProxy = () =>
  useFarmMutation((id: string) => FarmService.deleteProxy(id));

export const useCheckFarmProxy = () =>
  useFarmMutation((id: string) => FarmService.checkProxy(id));

export const useCheckAllFarmProxies = () =>
  useFarmMutation(() => FarmService.checkAllProxies());

export const useAssignFarmProxies = () =>
  useFarmMutation((reassignAll: boolean) =>
    FarmService.assignProxiesToEmails(reassignAll)
  );

export const useDeleteDeadFarmProxies = () =>
  useFarmMutation(() => FarmService.deleteDeadProxies());

// ─── Почты ────────────────────────────────────────────────────────────────

export const useGetFarmEmails = (params: FarmEmailListParams) => {
  return useQuery({
    queryKey: ["farm", "emails", params],
    queryFn: () => FarmService.getEmails(params),
    placeholderData: keepPreviousData,
  });
};

export const useImportFarmEmails = () =>
  useFarmMutation((text: string) => FarmService.importEmails(text));

export const useUpdateFarmEmailStatus = () =>
  useFarmMutation(({ id, status }: { id: string; status: FarmResourceStatus }) =>
    FarmService.updateEmail(id, { status })
  );

export const useDeleteFarmEmail = () =>
  useFarmMutation((id: string) => FarmService.deleteEmail(id));

export const useDeleteFarmEmailsBulk = () =>
  useFarmMutation((text: string) => FarmService.deleteEmailsBulk(text));

// Проверка входа ничего не меняет в базе — кэш не трогаем
export const useTestFarmEmail = () =>
  useMutation({
    mutationFn: (id: string) => FarmService.testEmail(id),
  });

export const useGetFarmEmailMessages = (id: string | null) => {
  return useQuery({
    queryKey: ["farm", "email-messages", id],
    queryFn: () => FarmService.getEmailMessages(id!),
    enabled: !!id,
    // IMAP медленный и может упасть — не долбим его повторами
    retry: false,
    staleTime: 30_000,
    // Ошибку чтения ящика окно писем показывает само
    meta: { silentError: true },
  });
};

// ─── Транки ───────────────────────────────────────────────────────────────

export const useGetFarmTrunks = () => {
  return useQuery({
    queryKey: ["farm", "trunks"],
    queryFn: () => FarmService.getTrunks(),
    refetchInterval: LIVE_REFETCH_MS,
  });
};

export const useGetFarmAsterisk = (enabled: boolean) => {
  return useQuery({
    queryKey: ["farm", "asterisk"],
    queryFn: () => FarmService.getAsterisk(),
    enabled,
    meta: { silentError: true },
  });
};

export const useCreateFarmTrunk = () =>
  useFarmMutation((form: FarmTrunkForm) => FarmService.createTrunk(form));

export const useUpdateFarmTrunk = () =>
  useFarmMutation(({ id, form }: { id: string; form: FarmTrunkForm }) =>
    FarmService.updateTrunk(id, form)
  );

export const useDeleteFarmTrunk = () =>
  useFarmMutation((id: string) => FarmService.deleteTrunk(id));

export const useGetFarmTrunkPhones = (
  trunkId: string | null,
  params: FarmListParams
) => {
  return useQuery({
    queryKey: ["farm", "trunk-phones", trunkId, params],
    queryFn: () => FarmService.getTrunkPhones(trunkId!, params),
    enabled: !!trunkId,
    placeholderData: keepPreviousData,
  });
};

export const useImportFarmTrunkPhones = () =>
  useFarmMutation(({ id, text }: { id: string; text: string }) =>
    FarmService.importTrunkPhones(id, text)
  );

export const useDeleteFarmTrunkPhone = () =>
  useFarmMutation((phoneId: string) => FarmService.deleteTrunkPhone(phoneId));

export const useRestoreFarmTrunkPhone = () =>
  useFarmMutation((phoneId: string) => FarmService.restoreTrunkPhone(phoneId));

export const useMarkFarmTrunkPhoneInvalid = () =>
  useFarmMutation((phoneId: string) =>
    FarmService.markTrunkPhoneInvalid(phoneId)
  );

export const useRestoreFarmNoCallPhones = () =>
  useFarmMutation(() => FarmService.restoreNoCallPhones());

export const useMarkFarmPhonesInvalidBulk = () =>
  useFarmMutation((text: string) => FarmService.markPhonesInvalidBulk(text));

// ─── Аккаунты ─────────────────────────────────────────────────────────────

export const useGetFarmAccounts = (params: FarmAccountListParams) => {
  return useQuery({
    queryKey: ["farm", "accounts", params],
    queryFn: () => FarmService.getAccounts(params),
    placeholderData: keepPreviousData,
  });
};

export const useGetFarmAccount = (id: string | null) => {
  return useQuery({
    queryKey: ["farm", "account", id],
    queryFn: () => FarmService.getAccount(id!),
    enabled: !!id,
    meta: { silentError: true },
  });
};

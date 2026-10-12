import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { FarmAccountsService } from "../services/farmAccounts.service";

// Любое действие над телефоном меняет цифры групп и шапки, поэтому после
// мутаций сбрасываем весь кэш раздела разом
const useAccountsMutation = <TVariables = void, TData = unknown>(
  mutationFn: (variables: TVariables) => Promise<TData>,
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["farm-accounts"] });
    },
  });
};

export const useGetFarmGroups = () =>
  useQuery({
    queryKey: ["farm-accounts", "groups"],
    queryFn: () => FarmAccountsService.getGroups(),
  });

export const useCreateFarmGroup = () =>
  useAccountsMutation(FarmAccountsService.createGroup);

export const useDeleteFarmGroup = () =>
  useAccountsMutation(FarmAccountsService.deleteGroup);

export const useGetFarmPhones = (params: {
  page?: number;
  pageSize?: number;
  search?: string;
  groupId?: string;
  status?: string;
}) =>
  useQuery({
    queryKey: ["farm-accounts", "phones", params],
    queryFn: () => FarmAccountsService.getPhones(params),
    // Страницы листаются часто — не мигаем пустой таблицей
    placeholderData: keepPreviousData,
  });

export const useCreateFarmPhones = () =>
  useAccountsMutation(FarmAccountsService.createPhones);

export const useCheckFarmProxiesBulk = () =>
  useAccountsMutation(FarmAccountsService.checkProxiesBulk);

export const useDeleteFarmPhones = () =>
  useAccountsMutation(FarmAccountsService.deletePhones);

export const useMoveFarmPhones = () =>
  useAccountsMutation(FarmAccountsService.movePhones);

export const useCheckFarmPhoneProxy = () =>
  useAccountsMutation(FarmAccountsService.checkProxy);

export const useReplaceFarmPhoneProxy = () =>
  useAccountsMutation(FarmAccountsService.replaceProxy);

export const useGetFarmPhoneEvents = (phoneId: string | null) =>
  useQuery({
    queryKey: ["farm-accounts", "events", phoneId],
    queryFn: () => FarmAccountsService.getEvents(phoneId!),
    enabled: !!phoneId,
  });

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AuthService } from "../services/auth.service";

export const useGetMe = (enabled = true) =>
  useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => AuthService.me(),
    enabled,
    staleTime: 60_000,
  });

export const useChangePassword = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: AuthService.changePassword,
    // Пароль сменён — плашка «пароль по умолчанию» должна уйти
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["auth", "me"] }),
  });
};

export const useGetAccessToken = () =>
  useQuery({
    queryKey: ["auth", "access-token"],
    queryFn: () => AuthService.getAccessToken(),
  });

export const useRegenerateAccessToken = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => AuthService.regenerateAccessToken(),
    onSuccess: (data) => queryClient.setQueryData(["auth", "access-token"], data),
  });
};

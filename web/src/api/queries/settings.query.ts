import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  SettingsService,
  type RegistrationSettings,
} from "../services/settings.service";

export const useGetRegistrationSettings = () =>
  useQuery({
    queryKey: ["settings", "registration"],
    queryFn: () => SettingsService.getRegistration(),
  });

export const useUpdateRegistrationSettings = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (form: Partial<RegistrationSettings>) =>
      SettingsService.updateRegistration(form),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["settings", "registration"] }),
  });
};

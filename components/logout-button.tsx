"use client";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export function LogoutButton() {
  const logout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    // Navegacao DURA, mesmo motivo do login: `router.push` serviria a copia de
    // `/auth/login` do Router Cache e, pior, deixaria no cache as paginas
    // renderizadas enquanto havia sessao. Sair tem de limpar de verdade.
    window.location.assign("/auth/login");
  };

  return <Button onClick={logout} variant="ghost" size="sm">
      Sair
    </Button>;
}

import { updateSession } from "@/lib/supabase/proxy";
import { type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Casa com tudo, menos:
     * - _next/static (arquivos estáticos)
     * - _next/image (otimização de imagem)
     * - favicon.ico
     * - imagens — .svg, .png, .jpg, .jpeg, .gif, .webp
     *
     * Havia aqui uma exceção para `api/discord`, que saiu junto com o bot em
     * 2026-09-22. A lição fica, porque vale para a próxima rota pública: este
     * proxy manda quem não tem sessão para `/auth/login`, então um endpoint
     * chamado por terceiro — que não manda cookie nenhum — leva `307` e nunca
     * roda. O sintoma é mudo do lado de lá, que foi o que custou caro.
     * Rota pública sai do matcher. Ver docs/bot-discord.md.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

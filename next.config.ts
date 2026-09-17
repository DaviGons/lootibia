import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,

  // A raiz e o analisador. Redirect no roteamento, nao com `redirect()` dentro
  // de uma pagina: no Next 16 isso impede a validacao de navegacao instantanea
  // e enche o log de "Could not validate `instant`" a cada requisicao.
  async redirects() {
    return [{ source: "/", destination: "/hunts", permanent: false }];
  },
};

export default nextConfig;

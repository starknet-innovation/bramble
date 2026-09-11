import { DocsPage } from "./pages/docs";
import { HomePage } from "./pages/home";
import { PrivacyPage } from "./pages/privacy";
import { SupportPage } from "./pages/support";

type Page = "docs" | "home" | "privacy" | "support";

const currentPage = (): Page => {
  const page = document.body.dataset["page"];
  return page === "docs" || page === "privacy" || page === "support" ? page : "home";
};

export const App = () => {
  switch (currentPage()) {
    case "docs":
      return <DocsPage />;
    case "privacy":
      return <PrivacyPage />;
    case "support":
      return <SupportPage />;
    case "home":
      return <HomePage />;
  }
};

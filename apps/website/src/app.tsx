import { DocsPage } from "./pages/docs";
import { HomePage } from "./pages/home";
import { SupportPage } from "./pages/support";

type Page = "docs" | "home" | "support";

const currentPage = (): Page => {
  const page = document.body.dataset["page"];
  return page === "docs" || page === "support" ? page : "home";
};

export const App = () => {
  switch (currentPage()) {
    case "docs":
      return <DocsPage />;
    case "support":
      return <SupportPage />;
    case "home":
      return <HomePage />;
  }
};

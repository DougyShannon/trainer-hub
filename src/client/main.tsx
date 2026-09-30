import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ArcadePage } from "./pages/arcade/ArcadePage";
import { WhosThatPage } from "./pages/arcade/WhosThatPage";
import { TypeQuizPage } from "./pages/arcade/TypeQuizPage";
import { RequestsPage } from "./pages/RequestsPage";
import { PlayPage } from "./pages/PlayPage";
import { GamePage } from "./pages/GamePage";
import { WorldPage } from "./pages/WorldPage";
import { PracticePage } from "./pages/PracticePage";
import { PracticeGamePage } from "./pages/PracticeGamePage";
import { MatMakerPage } from "./pages/MatMakerPage";
import { BrowserRouter, Route, Routes } from "react-router";
import { Layout } from "./components/Layout";
import { HomePage } from "./pages/HomePage";
import { CardsPage } from "./pages/CardsPage";
import { CardDetailPage } from "./pages/CardDetailPage";
import { PokedexPage } from "./pages/PokedexPage";
import { PokemonDetailPage } from "./pages/PokemonDetailPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { LoginPage, SignupPage } from "./pages/AuthPages";
import { SettingsPage } from "./pages/SettingsPage";
import { TrainerPage } from "./pages/TrainerPage";
import { DecksPage } from "./pages/DecksPage";
import { DeckBuilderPage } from "./pages/DeckBuilderPage";
import { DeckViewPage } from "./pages/DeckViewPage";
import { TeamsPage } from "./pages/TeamsPage";
import { TeamBuilderPage } from "./pages/TeamBuilderPage";
import { TeamViewPage } from "./pages/TeamViewPage";
import { AuthProvider } from "./lib/auth";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles.css";
import { loadUploadedBoards } from "./boards/library";

// Players' own play mats (from the "Add a board" page).
void loadUploadedBoards();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
    <AuthProvider>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="cards" element={<CardsPage />} />
          <Route path="cards/:id" element={<CardDetailPage />} />
          <Route path="pokedex" element={<PokedexPage />} />
          <Route path="pokedex/:slug" element={<PokemonDetailPage />} />
          <Route path="login" element={<LoginPage />} />
          <Route path="signup" element={<SignupPage />} />
          <Route path="me/settings" element={<SettingsPage />} />
          <Route path="trainer/:name" element={<TrainerPage />} />
          <Route path="decks" element={<DecksPage />} />
          <Route path="decks/new" element={<DeckBuilderPage />} />
          <Route path="decks/:id" element={<DeckViewPage />} />
          <Route path="decks/:id/edit" element={<DeckBuilderPage />} />
          <Route path="teams" element={<TeamsPage />} />
          <Route path="teams/new" element={<TeamBuilderPage key="new" />} />
          <Route path="teams/:id" element={<TeamViewPage />} />
          <Route path="teams/:id/edit" element={<TeamBuilderPage />} />
          <Route path="play" element={<PlayPage />} />
          <Route path="play/venues" element={<WorldPage />} />
          <Route path="play/practice" element={<PracticePage />} />
          <Route path="play/practice/:level" element={<PracticeGamePage />} />
          <Route path="play/mats" element={<MatMakerPage />} />
          <Route path="play/:id" element={<GamePage />} />
          <Route path="arcade" element={<ArcadePage />} />
          <Route path="arcade/whos-that-pokemon" element={<WhosThatPage />} />
          <Route path="arcade/type-quiz" element={<TypeQuizPage />} />
          <Route path="admin/requests" element={<RequestsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
    </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
);

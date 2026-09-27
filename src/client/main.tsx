import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
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
import { AuthProvider } from "./lib/auth";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
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
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
);

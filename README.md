# Fiszki PL ↔ EN

Lokalna aplikacja webowa do nauki słówek i definicji.

## Funkcje

- import plików `.txt`
- format `polska definicja --> english word`
- każda linia = osobna fiszka
- kierunek PL → EN lub EN → PL
- obracana fiszka
- przyciski „Umiem” / „Nie umiem”
- licznik wyników
- powtarzanie tylko błędnych fiszek
- powrót do całego zestawu
- zapis zestawów i wyników w SQLite
- historia sesji z datą
- ciemny interfejs
- skróty klawiaturowe:
  - `Spacja` — obróć fiszkę
  - `←` — nie umiem
  - `→` — umiem

## Instalacja

Wymagany Python 3.10 lub nowszy.

### Windows

1. Otwórz PowerShell lub CMD w katalogu projektu.
2. Opcjonalnie utwórz środowisko:
   `python -m venv .venv`
3. Aktywuj je:
   `.venv\Scripts\activate`
4. Zainstaluj Flask:
   `pip install -r requirements.txt`
5. Uruchom:
   `python app.py`
6. Otwórz:
   `http://127.0.0.1:5000`

### macOS / Linux

1. Otwórz terminal w katalogu projektu.
2. Opcjonalnie utwórz środowisko:
   `python3 -m venv .venv`
3. Aktywuj:
   `source .venv/bin/activate`
4. Zainstaluj Flask:
   `pip install -r requirements.txt`
5. Uruchom:
   `python3 app.py`
6. Otwórz:
   `http://127.0.0.1:5000`

## Format pliku

Każda fiszka znajduje się w osobnej linii:

`polska definicja --> english word`

Przykład znajdziesz w `sample_slownik.txt`.

## Dane

Baza `flashcards.db` zostanie utworzona automatycznie przy pierwszym uruchomieniu.
Załadowane pliki są kopiowane do katalogu `uploads/`.

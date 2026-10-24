; Ephemeris installer look and wording (electron-builder includes this before the pages).
; Artwork: installerSidebar.bmp and installerHeader.bmp, rendered from the design system
; by scripts/build-installer-art.mjs (pnpm installer-art).

; Text in chooser-ink on the white pages, like the app's chooser.
!define MUI_TEXTCOLOR 2A3038

!ifndef BUILD_UNINSTALLER
  !define MUI_FINISHPAGE_TITLE "Ephemeris is ready"
  !define MUI_FINISHPAGE_TEXT "Open Ephemeris and choose a folder for your library, or start a new one. Your notes are plain Markdown files in that folder.$\r$\n$\r$\nClick Finish to close Setup."
!else
  ; The uninstaller's welcome page: say plainly that notes are safe.
  !define MUI_WELCOMEPAGE_TITLE "Uninstall Ephemeris"
  !define MUI_WELCOMEPAGE_TEXT "This removes the Ephemeris app from this computer.$\r$\n$\r$\nYour notes are not touched: they stay in your library folder, and Ephemeris's settings are kept in case you install it again.$\r$\n$\r$\nClick Next to continue."
!endif

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Welcome to Ephemeris"
  !define MUI_WELCOMEPAGE_TEXT "Ephemeris keeps your Markdown notes in Vaults, grouped into Academic, Work and Personal.$\r$\n$\r$\nBy default Setup installs it for your account only, with no administrator rights needed. Installing, updating or uninstalling never touches your notes.$\r$\n$\r$\nClick Next to continue."
  !insertmacro MUI_PAGE_WELCOME
!macroend

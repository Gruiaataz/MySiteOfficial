# MySiteOfficial

Landing page premium pentru un studio de web design, cu animații, design responsive, formulare de contact, conturi cu autentificare email/parolă, link de confirmare prin email, sesiuni server-side în PostgreSQL și verificare anti-robot cu întrebare matematică.

## Ce include

- Design responsive pentru mobil, tabletă și desktop.
- Animații CSS, efecte la scroll, portofoliu demonstrativ și secțiuni de servicii/proces/prețuri.
- Înregistrare și autentificare cu email și parolă.
- Parole salvate cu bcrypt; emailuri normalizate; link de confirmare cu token aleator și expirare de 24 de ore.
- Cookie de sesiune `HttpOnly`, `SameSite=Lax`, sesiuni persistate în PostgreSQL, limitare de încercări și antete de securitate.
- Provocare aritmetică anti-robot validată pe server.
- Formular de proiect; solicitările se păstrează în tabelul `contact_messages` și pot fi trimise și pe email.
- Blueprint `render.yaml` pentru a crea aplicația și baza de date pe Render.

## Publicare pe GitHub + Render

1. Descarcă arhiva și dezarhiveaz-o. Încarcă fișierele și folderele din `mysiteofficial` în rădăcina unui repository GitHub (nu încărca arhiva ZIP ca un singur fișier).
2. În Render, alege **New → Blueprint**, conectează repository-ul și lasă Render să citească `render.yaml`. Blueprint-ul creează serviciul Node și baza PostgreSQL asociată.
3. După ce serviciul este creat, configurează **Environment** pentru aplicația `mysiteofficial`:
   - Opțional, `APP_URL` = adresa publică a serviciului sau domeniul personal; dacă lipsește, aplicația folosește automat adresa cererii curente.
   - `RESEND_API_KEY` = cheia API de la Resend.
   - `RESEND_FROM` = expeditor de pe un domeniu verificat, de exemplu `MySiteOfficial <noreply@domeniul-tau.ro>`.
   - `CONTACT_EMAIL` = adresa unde vrei să primești cererile de ofertă.
4. În Resend, creează un API key și verifică un domeniu expeditor. Pentru trimitere către clienți reali, ai nevoie de un domeniu verificat și de un expeditor autorizat. Nu pune cheia API în cod sau în GitHub.
5. După salvarea variabilelor, fă un **Manual Deploy → Deploy latest commit** dacă Render nu redeployează automat. Testează înregistrarea cu o adresă la care ai acces, apasă linkul din email, apoi conectează-te.

### Important despre email

Trimiterea emailurilor nu poate funcționa fără un furnizor de email și credentialele lui. Aplicația folosește API-ul HTTPS al Resend (nu SMTP), lucru util deoarece serviciile web gratuite Render blochează conexiunile SMTP uzuale. Fără `RESEND_API_KEY` și un `RESEND_FROM` valid, site-ul și paginile se vor încărca, dar înregistrările noi vor afișa un mesaj clar că verificarea prin email nu este configurată.

### Important despre baza de date și planul gratuit

Datele utilizatorilor nu se salvează în fișiere locale. Se utilizează PostgreSQL, deoarece filesystem-ul serviciilor web Render este temporar. Blueprint-ul este setat pentru planuri gratuite, potrivite pentru testare; baza de date PostgreSQL gratuită Render expiră după 30 de zile conform limitărilor platformei. Pentru un site real în care păstrezi conturile clienților, treci baza de date la un plan potrivit înainte de expirare și configurează backup-uri.

## Rulare locală (opțional)

Ai nevoie de Node.js 20+ și de o bază PostgreSQL accesibilă.

```bash
npm install
cp .env.example .env
# completează DATABASE_URL și SESSION_SECRET în .env
npm start
```

Deschide `http://localhost:3000`.

## Setări de brand

- Nume: **MySiteOfficial**
- Credit dezvoltatori: **6phf9 / Alex-Gruia**
- Textele, prețurile orientative, serviciile și proiectele-concept sunt în `public/index.html`.
- Proiectele North Studio, Mono Objects și Terra House sunt concepte demonstrative, nu proiecte prezentate ca fiind comandate de clienți reali.

## Notă de securitate și mentenanță

Provocarea matematică este o măsură anti-bot de bază, nu înlocuiește un serviciu CAPTCHA dedicat pentru trafic cu risc ridicat. Păstrează dependențele actualizate, nu împărtăși cheile secrete și verifică politicile de confidențialitate/termenii înainte de utilizarea publică. Codul nu oferă un dashboard administrativ pentru citirea directă a tuturor solicitărilor păstrate în baza de date; configurează `CONTACT_EMAIL` pentru notificări prin email.

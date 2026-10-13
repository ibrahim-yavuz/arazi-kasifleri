# Manual browser test checklist

Run `npm run dev` (or `npm run build && npm run preview`) and open the page in a desktop
browser. Keep the developer console open: any red error is a failure.

## Boot and menus
- [ ] The loading screen ("YÜKLENİYOR...") appears, then the main menu, within a few seconds.
- [ ] ↑/↓ moves the focus between YENİ OYUN, SEÇENEKLER, NASIL OYNANIR?, SKOR TABLOSU; Enter and mouse clicks both work.
- [ ] SEÇENEKLER: quality and volume bars change with ←/→ and the −/+ buttons; "Sesi kapat" toggles; Onayla saves (reload the page and check); İptal discards.
- [ ] NASIL OYNANIR? shows the key list and route description; Esc/Enter returns.
- [ ] SKOR TABLOSU shows "Henüz kayıtlı derece yok" before the first race and entries after one.

## Vehicle selection
- [ ] Dark garage; the selected car turns on a lit platform; the others stand behind with their names.
- [ ] ←/→ (and the on-screen arrows) cycle Panter → Örümcek → Boğa → Akrep; the name, description, stat bars and spec text update.
- [ ] Each car has a different silhouette: black boxy SUV / tube-frame buggy with moving shocks / yellow pickup with light bar / white hot-rod with red stripes and tail spoiler.
- [ ] Enter selects; "« Ana Menü" goes back.

## Track intro and start
- [ ] The intro panel shows the three routes; the controls guide appears only before the first race of the browser session (it is stored as seen).
- [ ] The camera circles the fork while the intro is open.
- [ ] Enter → yellow 3, 2, 1, BAŞLA! with beeps; the car cannot move during the countdown; the timer starts at BAŞLA.

## Driving feel (every car)
- [ ] W accelerates through the gears (speedometer, gear label and RPM arc react); the engine pitch follows RPM and gets louder with throttle.
- [ ] S brakes without locking (ABS). Holding S at a standstill engages reverse ("G"); reverse lights come on; W returns to drive.
- [ ] A/D steering is progressive (no instant turning); lock reduces at high speed; the body rolls in corners.
- [ ] Space (handbrake) slides the rear, brake lights glow.
- [ ] On the Cesaret crest and ramp the car leaves the ground, keeps its momentum, rotates naturally, lands with visible suspension compression and does not snap upright.
- [ ] On moguls, each wheel moves independently (watch the buggy's shocks and arms).
- [ ] Grass and sand are slower than the dirt road; the sand canyon raises sand-coloured dust.
- [ ] Roads are smooth (no washboard bumps). Hız feels easy; Bilgi winds; Cesaret is narrow and twisty with two bridges and is clearly the hardest, but gives the best time.
- [ ] Bridges: you drive on the wooden deck, railings stop the car, and falling into the river puts you in the riverbed (R resets).
- [ ] Tapping A/D at speed turns the car promptly; it does not spin out on dirt with full throttle.
- [ ] Hitting a tree, rock or fence stops the car with an impact sound; there is no tunnelling.
- [ ] Rolling the car leaves it on its roof; R puts it back on the last checkpoint.

## Race rules
- [ ] Driving through a gate shows "… yolu seçildi"; the HUD shows "Yol: …".
- [ ] Each route checkpoint shows "Kontrol noktası n/5".
- [ ] Bilgi: driving through a blue "?" sign collects it ("Soru işareti!" toast, "? × n" in the HUD); the race never stops.
- [ ] After the finish, "BİLGİ YARIŞMASI" asks exactly one question per "?" collected; A/B (or 1/2, or a click) answers; ✓/✗ feedback; the time changes by −3 s / +3 s; then the results. With no "?" collected, the results come straight away.
- [ ] Hourglass −3 s, sign +100 points, turbo boost: each with a sound and sparkles, each collectable once; the badge counter increases.
- [ ] Skipping your route's checkpoints and crossing the finish shows "Önce seçtiğin yolu tamamla!" and the race does not end.
- [ ] Crossing the finish backwards does not count.
- [ ] Driving backwards along the route shows "Ters yöndesin!".
- [ ] Finishing shows "BİTİŞ!", then the results (time breakdown, pickups, questions, standings vs. three rivals, leaderboard rank).
- [ ] Tekrar Oyna restarts with everything reset (timer, pickups visible again, rivals on the grid); Araç Değiştir → garage; Ana Menü → menu.

## Pause, focus and camera
- [ ] Esc pauses (timer frozen, sound off); DEVAM ET resumes without a jump in the simulation.
- [ ] Switching tab or window auto-pauses.
- [ ] Resizing the window keeps the view filling the screen with no distortion.
- [ ] C cycles close chase / far chase / bonnet. The close chase frames the car as in the reference: low behind, horizon in the upper third.
- [ ] The camera never goes underground and pulls in when a canyon wall or tree blocks the view.

## Developer tools (dev server or `?debug`)
- [ ] F3 shows wheel rays, springs (green→red with compression), contact points, normals, tyre forces, centre of mass, velocity and the telemetry panel.
- [ ] F4 opens the tuning panel; changing mass, spring rate, grip, torque or the camera applies immediately; "Ayarları JSON olarak kopyala" logs and copies the config.
- [ ] `?scene=test`: keys 1–8 teleport to each test feature; the readout shows 0–50/0–100, braking distance, instantaneous turning radius, airtime and compression; V changes car.

## Audio off
- [ ] With "Sesi kapat" on (or audio blocked by the browser) the game is fully playable.

## Multiplayer (two browser windows, side by side)
- [ ] ÇOK OYUNCULU → name → ODA KUR: the room code and share link appear; "Bağlantıyı kopyala" copies it.
- [ ] Opening the link in a second window joins the room directly; both windows list both players and the AI slots.
- [ ] A public room appears in the other window's "Açık odalar" list; a private one does not.
- [ ] Car choice (← →) and HAZIRIM update in both windows; the host's YARIŞI BAŞLAT stays disabled until everyone is ready.
- [ ] Both windows start the countdown together; each player sees the other's car moving smoothly and can bump into it.
- [ ] A back-row car is level with the front row a few seconds after the start when both hold full throttle.
- [ ] Esc online shows "MENÜ (yarış sürüyor!)" and the race keeps running.
- [ ] Finishing shows live standings ("yarışta" for others) that update as others finish; "Yarış tamamlandı." when everyone is done.
- [ ] Odaya Dön returns both to the room; a new race can start.
- [ ] Closing one window removes that player; if the host leaves, the next player becomes host.

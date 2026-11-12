# PriceSteamTool — Adatbázis Mentés és Visszaállítás (Backup & Restore)

Ez a dokumentum bemutatja a PriceSteamTool SQLite adatbázisának (`pricetool.db`) automatikus és manuális mentési folyamatát, valamint a katasztrófa utáni helyreállítás (restore) pontos lépéseit.

---

## 1. Hogyan működik a mentés?

- **Online mentés (Zero-downtime):** A rendszer a SQLite hivatalos Online Backup API-ját (`better-sqlite3` `db.backup()`) használja. Ez a futó írási/olvasási műveletek közben is konzisztens pillanatképet (snapshot) készít zárolás nélkül.
- **WAL Checkpoint:** A mentés indítása előtt a rendszer automatikusan lefuttat egy `PRAGMA wal_checkpoint(PASSIVE)` parancsot, szinkronizálva a még ki nem írt WAL kereteket.
- **Automatikus ellenőrzés (Quick Check):** Minden elkészült mentési fájlon azonnal lefut egy `PRAGMA quick_check` integritás-vizsgálat. Ha a mentés hibás, a rendszer törli a fájlt és hibát jelez.
- **Tárolási hely:** A mentések a Docker kötetben a `/data/backups/` mappában jönnek létre (a gazdagépen: `./data/backups/`).
- **Fájlnév formátum:** `pricetool-backup-YYYY-MM-DDTHH-mm-ss-SSSZ.db` (időrendi sorrendbe rendezhető, cross-platform ISO formátum).
- **Automatikus rotáció (7 napos megőrzés):** A rendszer alapértelmezetten megtartja a legfrissebb 7 mentést, a régebbi archívumokat automatikusan eltávolítja a tárhely védelme érdekében.

---

## 2. Ütemezés és konfiguráció

A mentés beállításai a `.env` vagy `docker-compose.yml` fájlban konfigurálhatók:

| Változó | Alapérték | Leírás |
|---|---|---|
| `BACKUP_ENABLED` | `true` | Automatikus háttérmentés engedélyezése (`true`/`false`). |
| `BACKUP_INTERVAL_HOURS` | `24` | Mentési gyakoriság órákban (alapértelmezetten naponta 1x). |
| `BACKUP_RETENTION_DAYS` | `7` | Megőrizendő legfrissebb mentések száma (rotációs limit). |

---

## 3. Manuális mentés indítása

Mentést a háttérütemezőn kívül manuálisan is kezdeményezhetsz:

### A) REST API-n keresztül (HTTP POST)
```bash
curl -X POST http://localhost:3000/api/backup
```
Válasz formátum:
```json
{
  "success": true,
  "backup": {
    "success": true,
    "backupPath": "/data/backups/pricetool-backup-2026-09-26T09-30-00-000Z.db",
    "fileName": "pricetool-backup-2026-09-26T09-30-00-000Z.db",
    "sizeBytes": 1048576,
    "createdAt": "2026-09-26T09:30:00.000Z",
    "prunedCount": 0,
    "prunedFiles": [],
    "durationMs": 42
  }
}
```

### B) Meglévő mentések listázása (HTTP GET)
```bash
curl http://localhost:3000/api/backups
```

### C) Webes felületről (UI — Adatbiztonság fül)
A webes felület **Adatbiztonság** (Data Safety / Anomalies) nézetében a jobb felső sarokban található **"Biztonsági mentés"** (Backup DB) gombra kattintva bármikor egyetlen kattintással készíthető azonnali snapshot mentés:
- Azonnal meghívja a `POST /api/backup` végpontot.
- Folyamatjelző spinner mutatja a futást.
- Sikeres mentéskor zöld visszajelző sávban megjelenik a mentett fájl neve, mérete (MB-ban) és az integritás-ellenőrzés sikere.

---

## 4. Visszaállítási eljárás (Restore Guide)

Ha az adatbázis megsérül vagy korábbi állapotot szeretnél visszaállítani, kövesd pontosan az alábbi lépéseket:

### 1. lépés: Állítsd le az alkalmazást
Az adatbázis fájl felülírása előtt kötelező leállítani az író folyamatot:
```bash
docker compose down
# vagy natív futtatásnál: állítsd le a node folyamatot (Ctrl+C)
```

### 2. lépés: Válaszd ki a kívánt mentést
Listázd ki a meglévő mentéseket a gazdagép `./data/backups/` könyvtárában:
```bash
ls -la ./data/backups/
# Windows PowerShell alatt:
dir ./data/backups
```

### 3. lépés: Készíts biztonsági másolatot a jelenlegi állapotról (Opcionális, de ajánlott)
```bash
mv ./data/pricetool.db ./data/pricetool.db.corrupted_bak
# Windows PowerShell alatt:
Move-Item ./data/pricetool.db ./data/pricetool.db.corrupted_bak
```

### 4. lépés: Másold be a mentést a fő adatbázis helyére
Másold a kiválasztott mentési fájlt `pricetool.db` néven a `./data/` gyökerébe:
```bash
cp ./data/backups/pricetool-backup-YYYY-MM-DDTHH-mm-ss-SSSZ.db ./data/pricetool.db
# Windows PowerShell alatt:
Copy-Item ./data/backups/pricetool-backup-YYYY-MM-DDTHH-mm-ss-SSSZ.db ./data/pricetool.db
```

### 5. lépés: Töröld a régi WAL és SHM fájlokat
**FONTOS:** Ha létezik `pricetool.db-wal` vagy `pricetool.db-shm` a `./data` mappában, ezeket el kell távolítani, hogy a SQLite ne próbáljon összeférhetetlen tranzakciós naplót összefűzni a visszaállított adatbázissal:
```bash
rm -f ./data/pricetool.db-wal ./data/pricetool.db-shm
# Windows PowerShell alatt:
Remove-Item ./data/pricetool.db-wal, ./data/pricetool.db-shm -ErrorAction SilentlyContinue
```

### 6. lépés: Indítsd újra a konténert
```bash
docker compose up -d
```

### 7. lépés: Ellenőrizd a működést
Kérd le az egészségi állapotot és a játékok számát:
```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/wishlist
```
Ha a `/api/health` `{"status":"ok","database":"ok"}` választ ad, a visszaállítás sikeresen befejeződött.

---

## 5. Történeti árrekordok és esemény-újrabesorolás helyreállítása (Historical Repair Tooling)

A korábbi scraper és áresés-besorolási algoritmusok a történeti adatbázisban bizonyos esetekben tévesen rögzítettek `RECORD_DROP` vagy `EXTREME_DROP` eseményeket (pl. mikrozaj, devizaváltási kerekítés miatti 0,01 €-s ingadozások, vagy olyan ajánlatok, amelyek pusztán közel voltak az ATL-hez, de nem képviseltek új áresést).

A v2.10.2 verzió tartalmazza a dedikált, tranzakcionálisan biztonságos és visszafordítható karbantartó eszközt: `scripts/repair-historical-price-events.cjs`.

### 5.1 Karbantartási és biztonsági protokoll (SOP)

Mielőtt bármilyen javítást élesítenél az adatbázison, kövesd ezt a standard üzemeltetési eljárást:

1. **WAL kiürítése és zárolásmentes mentés:**
   Állítsd le az alkalmazást, vagy futtass egy WAL ellenőrzőpontot:
   ```bash
   # Konténerben vagy lokális SQLite paranccsal:
   sqlite3 ./data/pricetool.db "PRAGMA wal_checkpoint(TRUNCATE);"
   ```
2. **Fizikai biztonsági másolat készítése:**
   ```bash
   cp ./data/pricetool.db ./data/pricetool.db.pre_repair_bak
   # Windows PowerShell alatt:
   Copy-Item ./data/pricetool.db ./data/pricetool.db.pre_repair_bak
   ```

### 5.2 Száraz futás (Dry Run) — nulla adatbázis-írás
A javító script első lépésként mindig száraz módban futtatható. Ez végigelemzi az összes történeti megfigyelést időrendben, összeveti a tárolt besorolást a szigorított új szabályrendszerrel, és kimutatást készít az érintett rekordokról és egyedi játékokról:
```bash
node scripts/repair-historical-price-events.cjs --dry-run
# vagy egyedi adatbázis elérési úttal:
node scripts/repair-historical-price-events.cjs --db ./data/pricetool.db --dry-run
```
Kimenet: Részletes táblázat a javítandó eseménytípusokról (pl. `RECORD_DROP` $\rightarrow$ `FIRST_OBSERVED_AT_ATL`, `MODERATE_DROP` $\rightarrow$ `NO_CHANGE_STABLE`), érintett játékok számáról, miközben az adatbázis teljesen érintetlen marad (`dryRun: true`, 0 módosítás).

### 5.3 Javítás alkalmazása (Apply)
A `--apply` kapcsolóval indított futtatás tranzakcióban hajtja végre a javítást:
```bash
node scripts/repair-historical-price-events.cjs --apply
# vagy egyedi adatbázis elérési úttal:
node scripts/repair-historical-price-events.cjs --db ./data/pricetool.db --apply
```
- **Automatikus belső biztonsági tábla:** Létrehozza a `_repair_backup_price_events` táblát a módosítás előtt, lementve a rekordok eredeti `price_event`, `price_drop_eur` és `price_drop_percent` értékeit.
- **Tranzakciós végrehajtás:** Az összes módosítás egyetlen SQLite tranzakcióban fut le; hiba esetén automatikus a `ROLLBACK`.

### 5.4 Visszavonás (Rollback)
Ha a javítás után bármilyen okból vissza szeretnéd állítani az eredeti esemény-besorolásokat:
```bash
node scripts/repair-historical-price-events.cjs --rollback
```
- **Szelektív visszaállítás:** Kizárólag a `_repair_backup_price_events` táblában rögzített mezőket állítja vissza eredeti állapotukra.
- **Utólagos adatok megőrzése:** Nem írja felül a javítás óta beérkezett újabb ármegfigyeléseket, így nem okoz adatvesztést még akkor sem, ha a rendszer időközben már futott és új adatokat rögzített.

### 5.5 Utólagos ellenőrzés
A futtatást követően ellenőrizd az adatbázis integritását:
```bash
sqlite3 ./data/pricetool.db "PRAGMA quick_check;"
```
Ha az eredmény `ok`, a karbantartás sikeresen és sérülésmentesen lezárult.

# נכסים ריאליסטיים (אופציונלי)

שים כאן קבצי דמויות ונשקים, ורשום אותם ב־`manifest.json`. בלי manifest המשחק משתמש במודלים הפרוצדורליים.

## זומבים (Mixamo)
1. ב־mixamo.com בחר דמות זומבי (למשל Warzombie או Zombiegirl) והורד FBX **With Skin**.
2. לכל אנימציה (Zombie Walk, Zombie Run, Zombie Attack, Zombie Death, Zombie Idle) הורד FBX **Without Skin**.
3. שמור את הכל בתיקייה הזו וכתוב:

```json
{
  "zombies": [{ "file": "warzombie.fbx", "height": 1.8 }],
  "anims": { "walk": "zombie_walk.fbx", "run": "zombie_run.fbx", "attack": "zombie_attack.fbx", "death": "zombie_death.fbx", "idle": "zombie_idle.fbx" }
}
```
אפשר כמה דמויות ב־`zombies`; כל זומבי מקבל אחת מהן באקראי. הגובה מתכוונן אוטומטית. הסרט הירוק והמסכה מתווספים לראש אוטומטית.

## נשקים (GLB)
```json
{
  "weapons": {
    "ak": { "file": "ak47.glb", "rot": [0, 90, 0], "length": 0.88 },
    "pistol": { "file": "pistol.glb" }, "mp5": { "file": "mp5.glb" }, "m4": { "file": "m4.glb" }, "shotgun": { "file": "shotgun.glb" }
  }
}
```
הקנה צריך להצביע ל־Z שלילי. אם המודל מסתובב הפוך, כוונן `rot` (במעלות). אפשר גם `pos` ו־`length`.

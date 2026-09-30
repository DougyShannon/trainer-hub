# Adding game boards to Trainer Hub

There are two kinds of board picture:

- **Half mat**: one player's side of the table, like the six mats you sent. Used in the **Two half mats** layout. The mat has card spots printed on it, and the site puts each card on its spot.
- **Full board background**: a picture that sits behind the whole **Full board**. It should have no card spots printed on it, because the full board moves its cards around to fit each screen. Any landscape picture works (a field, a sky, a pattern). The site fades it a little so the cards stay easy to read.

Players pick either kind with the **Board** button at the top right of a game table, or in **Your board** on the Play page.

---

## Adding a half mat (no GitHub needed)

Anyone with an account can do this on the site:

1. Log in, go to **Play**, and click **Add a board** (under Your board).
2. **Choose a picture…** and pick the mat picture from your computer or phone (see Part 1 for what makes a good one).
3. Drag each box (Active, Bench 1 to 5, Prize 1 to 6, Deck, Discard and so on) onto the matching spot printed on the mat. Use **Card size** if the boxes are bigger or smaller than the printed spots.
4. Type a name and press **Upload**.

That's it: the mat is now in everyone's list under **Two half mats**. Press **Use it as my mat** to switch to it straight away. Whoever uploaded a mat (and Professor_D) can take it off the site again with **Remove** under "Boards players have added".

The rest of this guide is only for **full board backgrounds**, which still go in through GitHub.

---

## Part 1: Get the picture ready

1. Use a picture that is **wider than it is tall**. For a half mat, the Active spot should be at the top and the Bench along the bottom (like the mats you sent).
2. Crop off anything around the mat (a table, a white background).
3. Aim for about **1400 pixels wide** and under **500 KB**. A `.jpg` or `.webp` is best; `.png` works but is bigger.
4. Give it a short file name with **only lower case letters, numbers and dashes**, for example `pikachu-sunset.jpg`.

## Part 2: Upload the picture to GitHub

1. Go to **https://github.com/DougyShannon/trainer-hub** and sign in.
2. Click the **public** folder, then **art**, then **boards**.
3. Top right, click **Add file**, then **Upload files**.
4. Drag your picture into the box (or click **choose your files**).
5. At the bottom, choose **Create a new branch for this commit and start a pull request**. Name the branch something like `add-pikachu-board`.
6. Click **Propose changes**. On the next page, click **Create pull request**. Don't merge it yet.

## Part 3: Add it to the library list

1. Still on GitHub, click **Code** (top left), then change the branch drop-down (it says **main**) to your new branch, for example `add-pikachu-board`.
2. Open **src**, then **client**, then **boards**, then **library.ts**.
3. Click the **pencil** icon (top right of the file) to edit it.
4. Find `// Add new full board backgrounds here`. Click at the start of that line and type a line like this one, then press **Enter**:
   ```
     { id: "pikachu-sunset", name: "Pikachu sunset", image: "/art/boards/pikachu-sunset.jpg" },
   ```
   Change the three parts in quotes: the **id** (lower case and dashes, not used by any other board), the **name** players see, and the **file name** at the end of image.
5. Check your new line looks like the lines above it: it starts with `{`, ends with `},`, and every name is inside `"double quotes"`.
6. Click **Commit changes…**, make sure **Commit directly to the add-pikachu-board branch** is picked, and click **Commit changes**.

## Part 4: Put it live

1. Go to the **Pull requests** tab and open your pull request.
2. Wait for the checks at the bottom to finish. A **green tick** means the site still builds. A **red cross** usually means a typing slip in the line from Part 3: open library.ts on your branch again, fix it (compare with the lines above it), and commit again.
3. When it's green, click **Merge pull request**, then **Confirm merge**.
4. The site updates by itself in a few minutes. Open a game, press **Board**, and your new board is in the list.

---

### If something looks wrong

- **Cards sit off an uploaded mat's printed spots**: remove it on the Add a board page, then upload it again with the boxes lined up better.
- **You're stuck**: send the picture to Claude in the project and ask for it to be added.

### Handy to know

- Each player's choice is saved in their own browser, so everyone can pick a different board.
- In a live game each player sees their own mat at the bottom and their opponent's choice upside down at the top. Practice opponents play on the mat that suits their Gym's type (Lt. Surge gets Thunder, Misty gets Tide and so on).
- Pictures of Pokémon are Nintendo's artwork. It's the same small risk you accepted for the six mats; keep "Pokemon" out of the site's name.

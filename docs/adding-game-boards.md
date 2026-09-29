# Adding game boards to Trainer Hub

There are two kinds of board picture:

- **Half mat**: one player's side of the table, like the six mats you sent. Used in the **Two half mats** layout. The mat has card spots printed on it, and the site puts each card on its spot.
- **Full board background**: a picture that sits behind the whole **Full board**. It should have no card spots printed on it, because the full board moves its cards around to fit each screen. Any landscape picture works (a field, a sky, a pattern). The site fades it a little so the cards stay easy to read.

Players pick either kind with the **Board** button at the top right of a game table, or in **Your board** on the Play page.

---

## Part 1: Get the picture ready

1. Use a picture that is **wider than it is tall**. For a half mat, the Active spot should be at the top and the Bench along the bottom (like the mats you sent).
2. Crop off anything around the mat (a table, a white background).
3. Aim for about **1400 pixels wide** and under **500 KB**. A `.jpg` or `.webp` is best; `.png` works but is bigger.
4. Give it a short file name with **only lower case letters, numbers and dashes**, for example `pikachu-sunset.jpg`.

## Part 2 (half mats only): Line up the card spots

1. Go to **https://trainer-hub.blackhive.workers.dev/play/mats** (the Play page's **Your board** box has an **Add a board** link to it).
2. Press **Choose a picture…** and pick your picture from your computer. It only loads in your browser; nothing is uploaded yet.
3. Blue boxes appear on the mat. **Drag each box onto the matching spot printed on the mat**: Active, Stadium, Deck, Discard, Bench 1 to 5 and Prize 1 to 6. **Lost Zone** can go in any empty space, and **Name** (the player's name tag) is best over the logo.
   - If the boxes are too big or small for the printed spots, move the **Card size** slider first.
   - If your mat looks like the ones you sent, the boxes may already be in the right place. Then you don't need to move anything.
4. In step 3 on that page, type the **Name** players will see, and check the **File name** matches your picture's file name.
5. Press **Copy the line**. Paste it somewhere safe (a note or email to yourself) for Part 4.

## Part 3: Upload the picture to GitHub

1. Go to **https://github.com/DougyShannon/trainer-hub** and sign in.
2. Click the **public** folder, then **art**, then:
   - **mats** for a half mat, or
   - **boards** for a full board background.
3. Top right, click **Add file**, then **Upload files**.
4. Drag your picture into the box (or click **choose your files**).
5. At the bottom, choose **Create a new branch for this commit and start a pull request**. Name the branch something like `add-pikachu-mat`.
6. Click **Propose changes**. On the next page, click **Create pull request**. Don't merge it yet.

## Part 4: Add it to the library list

1. Still on GitHub, click **Code** (top left), then change the branch drop-down (it says **main**) to your new branch, for example `add-pikachu-mat`.
2. Open **src**, then **client**, then **boards**, then **library.ts**.
3. Click the **pencil** icon (top right of the file) to edit it.
4. Find the right line:
   - **Half mat**: find `// Add new half mats here`. Click at the **start of that line** and paste the line you copied in Part 2, then press **Enter**.
   - **Full board background**: find `// Add new full board backgrounds here`. Click at the start of that line and type a line like this one, then press **Enter**:
     ```
       { id: "pikachu-sunset", name: "Pikachu sunset", image: "/art/boards/pikachu-sunset.jpg" },
     ```
     Change the three parts in quotes: the **id** (lower case and dashes, not used by any other board), the **name** players see, and the **file name** at the end of image.
5. Check your new line looks like the lines above it: it starts with `{`, ends with `},`, and every name is inside `"double quotes"`.
6. Click **Commit changes…**, make sure **Commit directly to the add-pikachu-mat branch** is picked, and click **Commit changes**.

## Part 5: Put it live

1. Go to the **Pull requests** tab and open your pull request.
2. Wait for the checks at the bottom to finish. A **green tick** means the site still builds. A **red cross** usually means a typing slip in the line from Part 4: open library.ts on your branch again, fix it (compare with the lines above it), and commit again.
3. When it's green, click **Merge pull request**, then **Confirm merge**.
4. The site updates by itself in a few minutes. Open a game, press **Board**, and your new board is in the list.

---

### If something looks wrong

- **Cards sit off the printed spots**: open the Add a board page again, line the boxes up, copy the new line, and replace your old line in library.ts with it (the same way as Part 4).
- **The mat looks squashed**: the `aspect` number in the line should be the picture's width divided by its height. The Add a board page works it out for you when you choose the picture.
- **You're stuck**: upload the picture (Part 3) and ask Claude in the project to add it. Claude can line up the spots for you.

### Handy to know

- Each player's choice is saved in their own browser, so everyone can pick a different board.
- In a live game each player sees their own mat at the bottom and their opponent's choice upside down at the top. Practice opponents play on the mat that suits their Gym's type (Lt. Surge gets Thunder, Misty gets Tide and so on).
- Pictures of Pokémon are Nintendo's artwork. It's the same small risk you accepted for the six mats; keep "Pokemon" out of the site's name.

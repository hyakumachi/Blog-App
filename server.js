require("dotenv").config();
const jwt = require("jsonwebtoken");
const sanitizeHtml = require("sanitize-html");
const bcrypt = require("bcrypt");
const cookieParser = require("cookie-parser");
const express = require("express");
const db = require("better-sqlite3")("database.db");
db.pragma("journal_mode = WAL");

//db setup starts here
const createTables = db.transaction(() => {
  db.prepare(
    `
        CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username STRING NOT NULL UNIQUE,
        password STRING NOT NULL
        )`
  ).run();

  db.prepare(
    `
        CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        createdDate TEXT,
        title STRING NOT NULL,
        body TEXT NOT NULL,
        authorid INTEGER,
        FOREIGN KEY (authorid) REFERENCES users(id)
        )`
  ).run();
});

createTables();

//db setup ends here

const app = express();

app.set("view engine", "ejs");
app.use(express.urlencoded({ extended: false }));
app.use(express.static("public"));
app.use(cookieParser());

app.use(function (req, res, next) {
  res.locals.errors = [];

  // try to decode token/cookie
  try {
    const decoded = jwt.verify(
      req.cookies.KaonAronMaVloggerApp,
      process.env.JWTSECRET
    );
    req.user = decoded;
  } catch (err) {
    req.user = false;
  }

  res.locals.user = req.user;
  console.log(req.user);

  next();
});

app.get("/", (req, res) => {
  if (req.user) {
    const postsStatement = db.prepare("SELECT * FROM posts WHERE authorid = ?")
    const posts = postsStatement.all(req.user.userid) 
    return res.render("dashboard", { posts });
  }

  res.render("homepage");
});

app.get("/login", (req, res) => {
  res.render("login");
});

app.get("/logout", (req, res) => {
  res.clearCookie("KaonAronMaVloggerApp");
  res.redirect("/");
});

app.post("/login", (req, res) => {
  let errors = [];

  if (typeof req.body.username !== "string") req.body.username = "";
  if (typeof req.body.password !== "string") eq.body.password = "";

  if (req.body.username.trim() == "") errors = ["You must provide a username."];
  if (req.body.password.trim() == "") errors = ["You must provide a password."];

  if (errors.length) {
    return res.render("login", { errors });
  }

  const userInQuestionStatement = db.prepare(
    "SELECT * FROM users WHERE username = ?"
  );
  const userInQuestion = userInQuestionStatement.get(req.body.username);

  if (!userInQuestion) {
    errors = ["Invalid username or password."];
    return res.render("login", { errors });
  }

  const matchOrNot = bcrypt.compareSync(
    req.body.password,
    userInQuestion.password
  );
  if (!matchOrNot) {
    errors = ["Invalid username or password."];
    return res.render("login", { errors });
  }

  const token = jwt.sign(
    {
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
      skyColor: "blue",
      userid: userInQuestion.id,
      username: userInQuestion.username,
    },
    process.env.JWTSECRET
  );

  res.cookie("KaonAronMaVloggerApp", token, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    maxAge: 1000 * 60 * 60 * 24,
  });

  res.redirect("/");
});

function mustbeLoggedIn(req, res, next) {
  if (req.user) {
    return next();
  }
  res.redirect("/");
}

app.get("/create-post", mustbeLoggedIn, (req, res) => {
  res.render("create-post");
});

function sharedPostValidation(req) {
  const errors = [];

  if (typeof req.body.title !== "string") req.body.title = "";
  if (typeof req.body.body !== "string") req.body.body = "";

  //trim the title and body
  req.body.title = sanitizeHtml(req.body.title.trim(), {
    allowedTags: [],
    allowedAttributes: {},
  });
  req.body.body = sanitizeHtml(req.body.body.trim(), {
    allowedTags: [],
    allowedAttributes: {},
  });

  if (!req.body.title) errors.push("Please provide a title.");
  if (!req.body.body) errors.push("Please provide content.");

  return errors;
}

app.get("/posts/:id", (req, res) => {
  const statement = db.prepare("SELECT posts.*, users.username FROM posts INNER JOIN users ON posts.authorid = users.id WHERE posts.id = ?");
  const post = statement.get(req.params.id);

  if (!post) {
    return res.redirect("/");
  }

  res.render("single-post", { post })
})

app.post("/create-post", mustbeLoggedIn, (req, res) => {
  const errors = sharedPostValidation(req);

  if (errors.length) {
    return res.render("create-post", { errors });
  }

  const ourStatement = db.prepare(
    "INSERT INTO posts (title, body, authorid, createdDate) VALUES (?, ?, ?, ?)"
  );
  const result = ourStatement.run(
    req.body.title,
    req.body.body,
    req.user.userid,
    new Date().toISOString()
  );
  const getPostStatement = db.prepare("SELECT * FROM posts WHERE ROWID = ?");
  const realPost = getPostStatement.get(result.lastInsertRowid);

  res.redirect(`/posts/${realPost.id}`);
});

app.post("/register", (req, res) => {
  const errors = [];

  if (typeof req.body.username !== "string") req.body.username = "";
  if (typeof req.body.password !== "string") eq.body.password = "";

  req.body.username = req.body.username.trim();

  if (!req.body.username) errors.push("You must provide a username.");
  if (req.body.username && req.body.username.length < 3)
    errors.push("Username must be at least 3 characters long.");
  if (req.body.username && req.body.username.length > 10)
    errors.push("Username cannot exceed 10 characters.");
  if (req.body.username && !req.body.username.match(/^[a-zA-Z0-9]+$/))
    errors.push("Username can only contain alphanumeric characters.");

  //check if the username is already taken
  const usernameStatement = db.prepare(
    "SELECT * FROM users WHERE username = ?"
  );
  const usernameCheck = usernameStatement.get(req.body.username);

  if (usernameCheck) errors.push("That username is already taken.");

  if (!req.body.password) errors.push("You must provide a password.");
  if (req.body.password && req.body.password.length < 8)
    errors.push("Password must be at least 8 characters long.");
  if (req.body.password && req.body.password.length > 21)
    errors.push("Password cannot exceed 21 characters.");

  if (errors.length) {
    return res.render("homepage", { errors });
  }

  //save the new user into a database
  const salt = bcrypt.genSaltSync(10);
  req.body.password = bcrypt.hashSync(req.body.password, salt);

  const ourStatement = db.prepare(
    "INSERT INTO users (username, password) VALUES (?, ?)"
  );
  const result = ourStatement.run(req.body.username, req.body.password);

  const lookupStatement = db.prepare("SELECT * FROM users WHERE ROWID = ?");
  const ourUser = lookupStatement.get(result.lastInsertRowid);

  //log the user in by giving them a cookie
  const token = jwt.sign(
    {
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
      skyColor: "blue",
      userid: ourUser.id,
      username: ourUser.username,
    },
    process.env.JWTSECRET
  );

  res.cookie("KaonAronMaVloggerApp", token, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    maxAge: 1000 * 60 * 60 * 24,
  });

  res.redirect("/");
});

app.listen(3000);

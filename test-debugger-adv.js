const obj = { a: 1, b: 2 };

function inner() {
  this.c = 3;
  debugger;
  return this.a + this.b + this.c;
}

function outer() {
  return inner.call(obj);
}

console.log(outer());

@0xdbb9ad1f14bf0b36;

struct Point {
  x @0 :Float64;
  y @1 :Float64;
}

struct Person {
  name @0 :Text;
  age @1 :UInt32;
  email @2 :Text;
  scores @3 :List(UInt32);
  active @4 :Bool;
}

struct GameState {
  playerPosition @0 :Point;
  health @1 :UInt32;
  inventory @2 :List(Text);
}

# Parelax
### (The parallax lib)

[See Parelax](https://www.youtube.com/watch?v=67-YUqCzfsc)

Still a WIP, middleman/webpack setup for quick browser testing


### Goals
- Create a highly performant, easy to use, and flexible parallax library


### Notes
- if a parallax element nested inside another both with vertical displacements (eg both change with `translateY`), the child will experience the same `translateY` as its parent (even when both have absolute positioning.) It is possible to try and counter the effects by increasing/decreasing `to` and `from` values for the child, but it is better to avoid nesting parallax elements to get the most predictable results.

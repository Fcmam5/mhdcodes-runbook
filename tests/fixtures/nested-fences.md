Write a README that contains a code sample:

````bash {id=nest0001}
cat > README.md <<'MD'
```sh
make install
```
MD
````

Tilde fences work too, and may hold backticks:

~~~sh {id=tild0001}
cat <<'MD'
```
inside
```
MD
~~~

A closing fence may be longer than the opening one:

```bash {id=long0001}
echo closed by five
`````

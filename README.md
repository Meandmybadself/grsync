# GRSync

# Overview
A commandline client for syncing photos from a Ricoh GR IIIx camera to a local device.

# Usage
Enable the wifi connection on your Ricoh GR IIIx camera & run commandline client:

```
grsync -a
```

## Download all photos

```
grsync -a
```

## Download photos after specific directory and file

```
grsync -d 100RICOH -f R0000005.JPG
```


# Building
```
nvm use
npm install
npm run build
```

# Related
[Node Single Executable Applications](https://nodejs.org/api/single-executable-applications.html)


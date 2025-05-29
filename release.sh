#!/bin/bash

set -e

# Check if version type is provided as argument
if [ $# -ne 1 ]; then
  echo "Usage: ./release.sh <patch|minor|major>"
  exit 1
fi

VERSION_TYPE=$1

# Validate version type
if [ "$VERSION_TYPE" != "patch" ] && [ "$VERSION_TYPE" != "minor" ] && [ "$VERSION_TYPE" != "major" ]; then
  echo "Error: Version type must be 'patch', 'minor', or 'major'"
  exit 1
fi

# Get current version from package.json
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "Current version: $CURRENT_VERSION"

# Bump version in package.json
echo "Bumping $VERSION_TYPE version..."
npm version $VERSION_TYPE --no-git-tag-version

# Get new version
NEW_VERSION=$(node -p "require('./package.json').version")
echo "New version: $NEW_VERSION"

# Build the library
echo "Building the library..."
bun run build

# Publish to npm
echo "Publishing to npm..."
npm publish

# Commit and push changes
echo "Committing changes..."
git add .
git commit -m "chore(release): v$NEW_VERSION"
git tag v$NEW_VERSION

echo "Pushing changes..."
git push
git push --tags

echo "Release v$NEW_VERSION completed successfully!"

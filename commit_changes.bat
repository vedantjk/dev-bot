@echo off
echo Staging all changes...
git add .

echo.
echo Creating commit...
git commit -m "test: add comprehensive test suite for KB service

- Add 25 unit tests covering all KB operations (CRUD, search, preferences)
- Add integration test with 7 real-world scenarios
- Add test documentation (TESTING.md, TEST_REPORT.md, README.md)
- Add automated test runner script (run_tests.sh)
- Update CMakeLists.txt to build tests with Google Test
- Update Dockerfiles to run tests during build
- Create KB_TESTS_SUMMARY.md documenting test coverage
- Verify correctness of add/extract, search, update, delete operations
- Verify persistence, thread safety, and embedding properties

All 25 unit tests + 7 integration scenarios passing.
Service ready for integration with dev-bot."

echo.
echo Commit complete! Run 'git push' to push to remote.
pause

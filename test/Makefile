
CXXFLAGS = -fprofile-arcs -ftest-coverage -O0 
main: main.o
	g++ $(CXXFLAGS) main.o -o main
main.o: main.cpp
	g++ $(CXXFLAGS) -c main.cpp -o main.o


main.gcov.json: main
	./main
	-gcov main.o -jm -buact > main.gcov.json
#	gzip -df main.gcov.json.gz
	echo $@

.PHONY: main.gcov.json
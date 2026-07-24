#include <stdio.h>
#include <string.h>

int main(int argc, const char** argv)
{
    if(argc == 2)
    {
        printf("2 args\n");
        if (strcmp(argv[1],"foo")==0 || strcmp(argv[1],"bar") )
        {
            printf("foo bar\n");
        }
    }else
    {
        printf("not 2 args\n");
    }

    return 0;
}
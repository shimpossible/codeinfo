#include <stdio.h>
#include <string.h>

template<int A>
int foo()
{
    if constexpr(A > 1) return 1;
    return 0;
}

int main(int argc, const char** argv)
{
    printf("%d \n", foo<1>() );
    printf("%d \n", foo<2>() );
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
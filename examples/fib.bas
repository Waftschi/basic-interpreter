10 REM Fibonacci numbers
20 A = 0 : B = 1
30 FOR I = 1 TO 15
40 PRINT A;" ";
50 T = A + B : A = B : B = T
60 NEXT I
70 PRINT

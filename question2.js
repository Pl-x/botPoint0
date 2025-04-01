// Question 2: Fibonacci Sequence
// Write a program to generate the Fibonacci sequence up to 100.
let first2 = [0, 1]
console.log(0)
console.log(1)
for(let range = 2;first2[range-1] <= 100;range++)
{
  first2[range] =first2[range-1] + first2[range-2]
  
  if(first2[range]<=100)
  {
    console.log(first2[range])
  }
}
